import { NextRequest } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { streamChat, type AIProvider } from "@/lib/ai-service"
import { logActivity }                 from "@/lib/activity-logger"
import { embedText }                   from "@/lib/rag/embeddings"
import { rateLimit, RATE_LIMITS, rateLimitSseResponse, isBodyTooLarge, BODY_LIMITS } from "@/lib/rate-limit"
import { getAllowedCompanyIds, isGlobalAdmin, getCurrentCompany } from "@/lib/company-scope"
import { parseSlashCommand } from "@/lib/slash-agents"
import { resolveAIMode, isAIMode, modelLabel } from "@/lib/ai/model-registry"

export const dynamic = "force-dynamic"

// ─── SSE helpers ──────────────────────────────────────────────────────────────

function sse(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Limite generoso para suportar /summarize — checagem por comando acontece depois
  if (isBodyTooLarge(req, BODY_LIMITS.summarize)) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "O texto enviado é muito grande. Divida em partes menores ou envie como fonte/documento para resumir." })}\n\n`,
      { status: 413, headers: { "Content-Type": "text/event-stream" } },
    )
  }

  const body = await req.json() as {
    messages:          { role: "user" | "assistant"; content: string }[]
    system?:           string
    session_id?:       string | null
    agent_id?:         string | null
    user_message:      string
    company_id?:       string
    provider?:         AIProvider
    model?:            string
    selected_ai_mode?: string
    attachment_ids?:   string[]
  }

  // ─── Sanitização: só aceitar roles válidos no histórico ──────────────────
  // Impede role injection (ex: mensagem com role "system" vinda do cliente)
  const safeMessages = (body.messages ?? [])
    .filter((m): m is { role: "user" | "assistant"; content: string } =>
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string"
    )
    .map(m => ({ role: m.role, content: m.content.slice(0, 32_000) }))

  // ─── Auth (client Supabase com cookies) ──────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Sessão expirada. Faça login novamente." })}\n\n`,
      { status: 401, headers: { "Content-Type": "text/event-stream" } },
    )
  }

  // ─── Rate limiting ────────────────────────────────────────────────────────
  const rl = rateLimit(`chat:${user.id}`, RATE_LIMITS.chat)
  if (!rl.ok) return rateLimitSseResponse(rl.resetAt)

  // ─── Validação de acesso: company_id e agent_id ───────────────────────────
  const admin = createAdminClient()

  const [isAdmin, allowedCompanies] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])

  // ── Slash command orchestration ───────────────────────────────────────────
  type SlashAgentRow = { id: string; command: string; label: string; system_prompt: string; model: string; provider: string }
  const slashParsed = parseSlashCommand(body.user_message)
  let slashAgent: SlashAgentRow | null = null

  if (slashParsed) {
    const { data: sa } = await admin
      .from("slash_agents")
      .select("id, command, label, system_prompt, model, provider, admin_only")
      .eq("command", slashParsed.command)
      .eq("active", true)
      .maybeSingle()

    if (sa && (!sa.admin_only || isAdmin)) {
      slashAgent = sa as unknown as SlashAgentRow
    }
  }

  // Valida company_id: deve pertencer às empresas do usuário
  const requestedCompany = body.company_id ?? null
  let resolvedCompany: string

  if (requestedCompany) {
    if (!isAdmin && !(allowedCompanies as string[]).includes(requestedCompany)) {
      return new Response(
        `data: ${JSON.stringify({ type: "error", error: "Sem acesso a esta empresa." })}\n\n`,
        { status: 403, headers: { "Content-Type": "text/event-stream" } },
      )
    }
    resolvedCompany = requestedCompany
  } else {
    resolvedCompany = await getCurrentCompany(user.id)
  }

  // Valida agent_id: agente deve existir e pertencer a uma empresa acessível
  if (body.agent_id) {
    const { data: agentRow } = await admin
      .from("agents")
      .select("id, companies, status")
      .eq("id", body.agent_id)
      .single()

    if (!agentRow || agentRow.status !== "active") {
      return new Response(
        `data: ${JSON.stringify({ type: "error", error: "Agente não encontrado." })}\n\n`,
        { status: 404, headers: { "Content-Type": "text/event-stream" } },
      )
    }

    if (!isAdmin) {
      const agentCompanies = (agentRow.companies as string[]) ?? []
      const accessible = agentCompanies.length === 0
        || agentCompanies.some(c => (allowedCompanies as string[]).includes(c))
      if (!accessible) {
        return new Response(
          `data: ${JSON.stringify({ type: "error", error: "Sem acesso a este agente." })}\n\n`,
          { status: 403, headers: { "Content-Type": "text/event-stream" } },
        )
      }
    }
  }

  // ─── Configuração do agente ───────────────────────────────────────────────

  // Modelos permitidos para usuários não-admin sem agente configurado.
  // Admin e agentes configurados no banco não têm restrição.
  const ALLOWED_FREE_MODELS: Record<string, string[]> = {
    anthropic: ["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-6"],
    openai:    ["gpt-4o-mini", "gpt-4o-mini-2024-07-18", "gpt-4o"],
  }

  let provider: AIProvider = body.provider ?? "anthropic"
  let model:    string | undefined = body.model
  let system:   string | undefined = body.system

  if (body.agent_id) {
    // Modelo vem do banco — confiável, sem restrição de whitelist
    const { data: cfg } = await admin
      .from("agent_model_configs")
      .select("provider, model_id, system_prompt")
      .eq("agent_id", body.agent_id)
      .single()

    if (!cfg) {
      return new Response(
        `data: ${JSON.stringify({ type: "error", error: "Agente sem configuração de modelo. Configure o modelo em Configurações > Modelos." })}\n\n`,
        { status: 422, headers: { "Content-Type": "text/event-stream" } },
      )
    }

    provider = cfg.provider as AIProvider
    model    = cfg.model_id
    if (cfg.system_prompt) system = cfg.system_prompt
  } else if (!isAdmin) {
    // Sem agente: valida provider e modelo contra whitelist
    const allowedProviders = Object.keys(ALLOWED_FREE_MODELS) as AIProvider[]
    if (!allowedProviders.includes(provider)) provider = "anthropic"

    const allowedModels = ALLOWED_FREE_MODELS[provider] ?? []
    if (model && !allowedModels.includes(model)) {
      return new Response(
        `data: ${JSON.stringify({ type: "error", error: `Modelo não permitido: ${model}.` })}\n\n`,
        { status: 403, headers: { "Content-Type": "text/event-stream" } },
      )
    }
  }

  // ── selected_ai_mode: sobrescreve provider/model se não for "jarvis" ────────
  let routedByJarvis = true
  const rawMode = body.selected_ai_mode?.toLowerCase()
  if (rawMode && rawMode !== "jarvis" && isAIMode(rawMode)) {
    const resolved = resolveAIMode(rawMode)
    if ("error" in resolved) {
      return new Response(
        `data: ${JSON.stringify({ type: "error", error: resolved.error })}\n\n`,
        { status: 422, headers: { "Content-Type": "text/event-stream" } },
      )
    }
    provider       = resolved.provider as AIProvider
    model          = resolved.model
    routedByJarvis = false
  }

  // Slash agent: sobrescreve provider/model APENAS se no modo jarvis (automático)
  // Se usuário escolheu IA manual, respeitamos essa escolha mas injetamos o system_prompt do slash agent
  if (slashAgent) {
    if (routedByJarvis) {
      provider = slashAgent.provider as AIProvider
      model    = slashAgent.model
    }
    system = slashAgent.system_prompt + (system ? `\n\n${system}` : "")
  }

  // ── Guard de tamanho por comando (chat normal tem limite menor) ──────────
  {
    const totalChars = safeMessages.reduce((s, m) => s + m.content.length, 0)
    const isSummarize = slashAgent?.command === "summarize"
    const charLimit   = isSummarize ? 200_000 : 80_000
    if (totalChars > charLimit) {
      return new Response(
        `data: ${JSON.stringify({ type: "error", error: isSummarize
          ? "O texto enviado é muito grande para o Resumidor. Divida em partes menores."
          : "O texto enviado é muito grande. Use /summarize para textos longos ou envie como fonte de conhecimento."
        })}\n\n`,
        { status: 413, headers: { "Content-Type": "text/event-stream" } },
      )
    }
  }

  // ── Slash: remove /comando da última mensagem antes de enviar à IA ────────
  if (slashAgent && slashParsed && safeMessages.length > 0) {
    const last = safeMessages[safeMessages.length - 1]
    if (last.role === "user") {
      safeMessages[safeMessages.length - 1] = {
        ...last,
        content: slashParsed.query || last.content,
      }
    }
  }

  // ─── Sessão ───────────────────────────────────────────────────────────────
  let sid = body.session_id ?? null

  if (!sid) {
    const title = body.user_message.slice(0, 80).trim() || "Nova conversa"
    const { data: sess, error: sessErr } = await admin
      .from("sessions")
      .insert({
        user_id:    user.id,
        agent_id:   body.agent_id ?? null,
        company_id: resolvedCompany,
        title,
        pinned:     false,
        archived:   false,
        tags:       [],
      })
      .select("id")
      .single()

    if (sessErr || !sess) {
      const msg = sessErr?.message ?? "Erro ao criar sessão"
      return new Response(
        `data: ${JSON.stringify({ type: "error", error: msg })}\n\n`,
        { status: 500, headers: { "Content-Type": "text/event-stream" } },
      )
    }
    sid = sess.id as string
  }

  // ─── Contexto de conhecimento (RAG semântico + fallback full-text) ──────────
  {
    try {
      const { data: rows } = await admin
        .from("session_sources")
        .select("source_id, knowledge_sources(id, name, type, content, embedding_status)")
        .eq("session_id", sid)

      if (rows && rows.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sources = rows.map(r => (r as any).knowledge_sources as {
          id: string; name: string; type: string; content: string | null; embedding_status: string | null
        } | null).filter(Boolean) as { id: string; name: string; type: string; content: string | null; embedding_status: string | null }[]

        const indexedIds = sources.filter(s => s.embedding_status === "done").map(s => s.id)
        let injectedCtx = false

        // ── Tentativa RAG semântico ─────────────────────────────────────
        if (indexedIds.length > 0) {
          try {
            const queryEmbedding = await embedText(body.user_message.slice(0, 2000))
            const { data: chunks } = await admin.rpc("match_knowledge_chunks", {
              query_embedding:   `[${queryEmbedding.join(",")}]`,
              match_count:       8,
              filter_company:    resolvedCompany,
              filter_agent_id:   null,
              filter_source_ids: indexedIds,
              min_similarity:    0.35,
            })

            if (chunks && chunks.length > 0) {
              const parts = (chunks as { title?: string | null; source_type?: string | null; content: string }[])
                .map(c => `[${c.title ?? c.source_type ?? "Fonte"}]\n${c.content}`)
              const ctx = `\n\nFONTES DE CONHECIMENTO (busca semântica — ${parts.length} trecho(s)):\n${parts.join("\n\n---\n\n")}\n`
              system = (system ?? "") + ctx
              injectedCtx = true

              void logActivity({
                userId:    user.id,
                eventType: "source",
                action:    "chat_rag_injected",
                detail:    `${parts.length} trecho(s) semântico(s)`,
                sessionId: sid as string,
                companyId: resolvedCompany,
              })
            }
          } catch (ragErr) {
            console.warn("[chat] RAG falhou, usando fallback full-text:", ragErr)
          }
        }

        // ── Fallback: injetar conteúdo completo (fontes sem embedding) ──
        if (!injectedCtx) {
          const CONTEXT_CHAR_LIMIT = 40_000
          const parts: string[] = []
          let totalChars = 0

          for (const src of sources) {
            if (!src.content) continue
            const remaining = CONTEXT_CHAR_LIMIT - totalChars
            if (remaining <= 0) break
            const excerpt = src.content.slice(0, remaining)
            parts.push(`=== ${src.name} (${src.type}) ===\n${excerpt}`)
            totalChars += excerpt.length
          }

          if (parts.length > 0) {
            system = (system ?? "") + `\n\nFONTES DE CONHECIMENTO ATIVAS:\n${parts.join("\n\n")}\n`

            void logActivity({
              userId:    user.id,
              eventType: "source",
              action:    "chat_fulltext_injected",
              detail:    `${parts.length} fonte(s) — ${totalChars} chars`,
              sessionId: sid as string,
            })
          }
        }
      }
    } catch (ctxErr) {
      console.warn("[chat] Erro ao buscar contexto de conhecimento:", ctxErr)
    }
  }

  // ─── Contexto de anexos ───────────────────────────────────────────────────
  if (body.attachment_ids && body.attachment_ids.length > 0) {
    try {
      const { data: attachRows } = await admin
        .from("chat_attachments")
        .select("id, file_name, file_type, mime_type, extracted_text, metadata")
        .in("id", body.attachment_ids)
        .eq("user_id", user.id)  // segurança: só do próprio usuário
        .is("deleted_at", null)

      if (attachRows && attachRows.length > 0) {
        const attachCtx: string[] = []
        for (const att of attachRows) {
          if (att.extracted_text) {
            const header = `=== Arquivo anexado: ${att.file_name} (${att.file_type}) ===`
            attachCtx.push(`${header}\n${att.extracted_text.slice(0, 40_000)}`)
          } else if (att.file_type === "image") {
            attachCtx.push(`=== Imagem anexada: ${att.file_name} ===\n[Imagem enviada pelo usuário — análise de visão disponível em providers compatíveis]`)
          } else {
            const meta = (att.metadata as Record<string, unknown>) ?? {}
            const warn = meta.warning as string | undefined
            attachCtx.push(`=== Arquivo anexado: ${att.file_name} ===\n${warn ?? "Conteúdo não disponível para extração automática."}`)
          }
        }
        if (attachCtx.length > 0) {
          system = (system ?? "") + `\n\nANEXOS DO USUÁRIO:\n${attachCtx.join("\n\n")}\n`
        }
      }
    } catch (attachErr) {
      console.warn("[chat] Erro ao carregar anexos:", attachErr)
    }
  }

  // ─── Salvar mensagem do usuário ───────────────────────────────────────────
  {
    const { error: e } = await admin.from("messages").insert({
      session_id: sid,
      role:       "user",
      content:    body.user_message,
      agent_id:   null,
      status:     "done",
    })
    if (e) {
      // status pode não existir (migration 2 não aplicada) — fallback sem status
      console.warn("[chat] user msg insert failed, trying base:", e.message)
      await admin.from("messages").insert({
        session_id: sid,
        role:       "user",
        content:    body.user_message,
        agent_id:   null,
      })
    }
  }

  // ─── Stream ───────────────────────────────────────────────────────────────
  const finalSid = sid

  const readable = new ReadableStream({
    async start(controller) {
      let accumulated = ""
      let doneSent    = false

      // Bloco de metadados que vai para `blocks` jsonb (persistido no banco)
      const msgBlocks = {
        slashCommand:    slashAgent?.command    ?? null,
        slashAgentLabel: slashAgent?.label      ?? null,
        aiMode:          rawMode                ?? "jarvis",
        routedByJarvis,
      }

      // ── Helper: salva mensagem do assistente no banco ──────────────────────
      async function saveAssistant(
        content:    string,
        status:     "done" | "error",
        errMsg?:    string,
        modelUsed?: string,
        provUsed?:  string,
      ): Promise<string | null> {
        if (!content) return null  // nunca salva vazio
        const row = {
          session_id:    finalSid,
          role:          "assistant" as const,
          content,
          blocks:        msgBlocks,        // metadados de IA persistidos
          agent_id:      body.agent_id ?? null,
          status,
          error_message: errMsg      ?? null,
          model_used:    modelUsed   ?? null,
          provider:      provUsed    ?? null,
        }
        const { data: inserted, error: e1 } = await admin
          .from("messages").insert(row).select("id").single()
        if (!e1) return (inserted?.id as string) ?? null
        // Fallback: sem colunas extras (status/error_message podem não existir)
        const { data: inserted2, error: e2 } = await admin.from("messages").insert({
          session_id: finalSid,
          role:       "assistant",
          content,
          blocks:     msgBlocks,
          agent_id:   body.agent_id ?? null,
        }).select("id").single()
        if (e2) {
          console.error("[chat] assistant save fallback failed:", e2.message)
          return null
        }
        return (inserted2?.id as string) ?? null
      }

      // ── Helper: emite done e fecha ─────────────────────────────────────────
      function emitDone(content: string, model: string, provider: string, usage: object, error: string | null, messageId: string | null = null) {
        if (doneSent) return
        doneSent = true
        controller.enqueue(sse({ type: "done", session_id: finalSid, message_id: messageId, content, model, provider, usage, error }))
      }

      // Sinaliza ao cliente qual agente vai responder
      if (slashAgent) {
        controller.enqueue(sse({ type: "agent_routed", command: slashAgent.command, label: slashAgent.label }))
      }

      try {
        for await (const chunk of streamChat({ messages: safeMessages, system, provider, model })) {

          if (!chunk.done) {
            // Delta parcial
            accumulated += chunk.text
            controller.enqueue(sse({ type: "delta", text: chunk.text }))

          } else if ("error" in chunk) {
            // Erro do provedor AI
            const errMsg = chunk.error ?? "Erro ao gerar resposta"
            console.error("[chat] AI provider error:", errMsg.slice(0, 200))

            // Mostra erro ao usuário como mensagem vísivel
            const displayMsg = `⚠️ ${errMsg.slice(0, 300)}`
            controller.enqueue(sse({ type: "error", error: errMsg }))

            if (slashAgent) {
              void admin.from("agent_executions").insert({
                user_id: user.id, session_id: finalSid, company_id: resolvedCompany,
                command: `/${slashAgent.command}`, slash_agent_id: slashAgent.id,
                routing_reason: "slash_command", status: "failed",
                error_message: errMsg.slice(0, 500), finished_at: new Date().toISOString(),
              })
            }

            const savedErrId = await saveAssistant(displayMsg, "error", errMsg)
            emitDone(displayMsg, provider, provider, { input_tokens: 0, output_tokens: 0 }, errMsg, savedErrId)

          } else {
            // Fim com sucesso
            const usedModel    = chunk.model
            const usedProvider = chunk.provider
            const usage        = chunk.usage

            // Fallback se IA retornou vazio
            if (!accumulated.trim()) {
              const fallback = slashAgent
                ? "Não consegui gerar uma resposta para esse comando. Tente reduzir o texto ou reformular o pedido."
                : "Não foi possível gerar uma resposta. Tente novamente."
              accumulated = fallback
              // Emite o fallback como delta para aparecer no chat
              controller.enqueue(sse({ type: "delta", text: fallback }))
            }

            const savedId = await saveAssistant(accumulated, "done", undefined, usedModel, usedProvider)

            void logActivity({
              userId:    user.id,
              eventType: "chat",
              action:    slashAgent ? `/${slashAgent.command} — ${slashAgent.label}` : "Mensagem enviada",
              detail:    `${modelLabel(usedProvider, usedModel)} (${routedByJarvis ? "Jarvis automático" : rawMode ?? "manual"})`,
              metadata:  {
                session_id:       finalSid,
                agent_id:         body.agent_id ?? null,
                slash_command:    slashAgent?.command ?? null,
                selected_ai_mode: rawMode ?? "jarvis",
                routed_by_jarvis: routedByJarvis,
                provider:         usedProvider,
                model:            usedModel,
                input_tokens:     usage.input_tokens,
                output_tokens:    usage.output_tokens,
              },
              sessionId: finalSid,
            })

            if (slashAgent) {
              void admin.from("agent_executions").insert({
                user_id: user.id, session_id: finalSid, company_id: resolvedCompany,
                command: `/${slashAgent.command}`, slash_agent_id: slashAgent.id,
                model_used: usedModel, provider_used: usedProvider,
                used_sources: (system ?? "").includes("FONTES DE CONHECIMENTO"),
                routing_reason: "slash_command", status: "done",
                input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
                finished_at: new Date().toISOString(),
              })
            }

            emitDone(accumulated, usedModel, usedProvider, usage, null, savedId)
          }
        }
      } catch (err: unknown) {
        // Erro de rede, timeout ou exceção inesperada
        const raw = err instanceof Error ? err.message : "Erro interno"
        console.error("[chat] stream exception:", raw.slice(0, 200))

        const userMsg = "Ocorreu um erro ao processar sua mensagem. Tente novamente."
        controller.enqueue(sse({ type: "error", error: userMsg }))

        if (slashAgent && !doneSent) {
          void admin.from("agent_executions").insert({
            user_id: user.id, session_id: finalSid, company_id: resolvedCompany,
            command: `/${slashAgent.command}`, slash_agent_id: slashAgent.id,
            routing_reason: "slash_command", status: "failed",
            error_message: raw.slice(0, 500), finished_at: new Date().toISOString(),
          })
        }

        const displayMsg = `⚠️ ${userMsg}`
        const savedCatchId = await saveAssistant(displayMsg, "error", raw)
        emitDone(displayMsg, provider, provider, { input_tokens: 0, output_tokens: 0 }, userMsg, savedCatchId)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Session-Id":      finalSid,
    },
  })
}
