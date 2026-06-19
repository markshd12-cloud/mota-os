import { NextRequest } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { streamChatWithFallback, type AIProvider } from "@/lib/ai-service"
import { logActivity }                 from "@/lib/activity-logger"
import { embedText }                   from "@/lib/rag/embeddings"
import { rateLimit, RATE_LIMITS, rateLimitSseResponse, isBodyTooLarge, BODY_LIMITS } from "@/lib/rate-limit"
import { getAllowedCompanyIds, isGlobalAdmin, getCurrentCompany } from "@/lib/company-scope"
import { parseSlashCommand } from "@/lib/slash-agents"
import { resolveAIMode, isAIMode, modelLabel } from "@/lib/ai/model-registry"
import { detectImagePrompt } from "@/lib/ai/detect-image-request"
import { generateImage, imageErrorMessage, GEMINI_IMAGE_MODEL } from "@/lib/ai/generate-image"
import { saveGeneratedImage } from "@/lib/storage/generated-images"

export const dynamic = "force-dynamic"

// ─── SSE helpers ──────────────────────────────────────────────────────────────

function sse(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

// ─── Geração de imagem (Gemini) ─────────────────────────────────────────────────
// Responde no MESMO protocolo SSE do chat (delta + done), persiste as mensagens
// (usuário e assistente) e embute a imagem como markdown `![](url)` apontando para
// o bucket público. Dispensa o LLM de texto e toda a máquina de RAG/contexto.

async function respondWithGeneratedImage(opts: {
  admin:       ReturnType<typeof createAdminClient>
  userId:      string
  userMessage: string
  prompt:      string
  sid:         string
  companyId:   string
  agentId:     string | null
}): Promise<Response> {
  const { admin, userId, userMessage, prompt, sid, companyId, agentId } = opts

  // Persiste a mensagem do usuário (mesmo padrão do fluxo normal, com fallback)
  {
    const { error } = await admin.from("messages").insert({
      session_id: sid, role: "user", content: userMessage, agent_id: null, status: "done",
    })
    if (error) {
      await admin.from("messages").insert({ session_id: sid, role: "user", content: userMessage, agent_id: null })
    }
  }

  // Salva a resposta do assistente; faz fallback se colunas extras não existirem
  async function saveAssistantMsg(content: string, status: "done" | "error", errMsg?: string): Promise<string | null> {
    const full = {
      session_id: sid, role: "assistant" as const, content,
      blocks: { kind: "image", aiMode: "imagem" }, agent_id: agentId,
      status, error_message: errMsg ?? null, model_used: GEMINI_IMAGE_MODEL, provider: "gemini",
    }
    const { data, error } = await admin.from("messages").insert(full).select("id").single()
    if (!error) return (data?.id as string) ?? null
    const { data: d2 } = await admin.from("messages").insert({
      session_id: sid, role: "assistant", content, blocks: { kind: "image" }, agent_id: agentId,
    }).select("id").single()
    return (d2?.id as string) ?? null
  }

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const img     = await generateImage(prompt)
        const url     = await saveGeneratedImage(img.base64, img.mimeType, `${companyId}/${sid}`)
        const alt     = prompt.replace(/[[\]]/g, "").slice(0, 80)
        const caption = img.text || "Aqui está a imagem gerada:"
        const content = `${caption}\n\n![${alt}](${url})`

        controller.enqueue(sse({ type: "delta", text: content }))
        const messageId = await saveAssistantMsg(content, "done")
        controller.enqueue(sse({
          type: "done", session_id: sid, message_id: messageId, content,
          model: GEMINI_IMAGE_MODEL, provider: "gemini",
          usage: { input_tokens: 0, output_tokens: 0 }, error: null,
        }))

        void logActivity({
          userId, eventType: "chat", action: "image_generated",
          detail: prompt.slice(0, 120), sessionId: sid, companyId,
          metadata: { model: GEMINI_IMAGE_MODEL },
        })
      } catch (err: unknown) {
        const raw      = err instanceof Error ? err.message : "Erro ao gerar imagem"
        console.error("[chat] image generation failed:", raw.slice(0, 200))
        const friendly = `⚠️ ${imageErrorMessage(raw)}`
        controller.enqueue(sse({ type: "error", error: friendly }))
        const messageId = await saveAssistantMsg(friendly, "error", raw)
        controller.enqueue(sse({
          type: "done", session_id: sid, message_id: messageId, content: friendly,
          model: GEMINI_IMAGE_MODEL, provider: "gemini",
          usage: { input_tokens: 0, output_tokens: 0 }, error: friendly,
        }))
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
      "X-Session-Id":      sid,
    },
  })
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
    messages:            { role: "user" | "assistant"; content: string }[]
    system?:             string
    session_id?:         string | null
    agent_id?:           string | null
    user_message:        string
    company_id?:         string
    provider?:           AIProvider
    model?:              string
    selected_ai_mode?:   string
    attachment_ids?:     string[]
    pending_source_ids?: string[]
    notion_page_ids?:    string[]
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

  // Escopo de conhecimento: a empresa atual + "grupo" (guarda-chuva do grupo
  // educacional, onde fica conhecimento compartilhado entre as empresas-filhas).
  const companyScope = resolvedCompany === "grupo"
    ? ["grupo"]
    : [resolvedCompany, "grupo"]

  // Transparência: coleta as fontes consultadas para mostrar ao usuário na resposta.
  const usedSources: { kind: string; label: string }[] = []
  const addSource = (kind: string, label: string) => {
    const l = label.trim()
    if (l && !usedSources.some(s => s.kind === kind && s.label === l)) usedSources.push({ kind, label: l })
  }

  // Valida agent_id: agente deve existir e pertencer a uma empresa acessível
  if (body.agent_id) {
    const { data: agentRow } = await admin
      .from("agents")
      .select("id, companies, status")
      .eq("id", body.agent_id)
      .eq("kind", "agent")
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

    // Vincula fontes pré-selecionadas antes da primeira mensagem (Opção 1)
    if (body.pending_source_ids && body.pending_source_ids.length > 0) {
      try {
        const { data: validSources } = await admin
          .from("knowledge_sources")
          .select("id")
          .in("id", body.pending_source_ids)
          .eq("company_id", resolvedCompany)
          .eq("status", "active")

        if (validSources && validSources.length > 0) {
          await admin
            .from("session_sources")
            .upsert(
              validSources.map((s) => ({ session_id: sid, source_id: s.id })),
              { onConflict: "session_id,source_id" },
            )
        }
      } catch (pendingErr) {
        console.warn("[chat] Erro ao vincular fontes pendentes:", pendingErr)
      }
    }
  }

  // ─── Geração de imagem (atalho: dispensa LLM de texto, RAG e contexto) ─────────
  // "/imagem <prompt>" ou linguagem natural ("crie uma imagem de ..."). Intercepta
  // antes da máquina de contexto, que não se aplica a geração de imagem.
  if (sid) {
    const imagePrompt = detectImagePrompt(body.user_message)
    if (imagePrompt) {
      return respondWithGeneratedImage({
        admin,
        userId:      user.id,
        userMessage: body.user_message,
        prompt:      imagePrompt,
        sid,
        companyId:   resolvedCompany,
        agentId:     body.agent_id ?? null,
      })
    }
  }

  // ─── Contexto de conhecimento (full-content + RAG suplementar + auto-detecção) ─
  {
    try {
      // 1. Fontes vinculadas à sessão — inclui source_files para fontes baseadas em arquivo
      const { data: rows } = await admin
        .from("session_sources")
        .select(`
          source_id,
          knowledge_sources(
            id, name, type, content, embedding_status,
            source_files(extracted_text)
          )
        `)
        .eq("session_id", sid)

      type SourceRow = {
        id: string; name: string; type: string; content: string | null
        embedding_status: string | null
        source_files?: { extracted_text: string | null }[] | null
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sources = (rows ?? []).map(r => (r as any).knowledge_sources as SourceRow | null)
        .filter((s): s is SourceRow => Boolean(s))

      const sessionSourceIds = new Set(sources.map(s => s.id))
      const indexedIds = sources.filter(s => s.embedding_status === "done").map(s => s.id)

      // 2. Todas as fontes indexadas do escopo (empresa + grupo) p/ auto-detecção
      const { data: allIndexed } = await admin
        .from("knowledge_sources")
        .select("id, name, type, embedding_status")
        .in("company_id", companyScope)
        .eq("status", "active")
        .eq("embedding_status", "done")

      const nonSessionIndexed = (allIndexed ?? []).filter(s => !sessionSourceIds.has(s.id))

      // 3. Embedding sob demanda (reusado por: memória do agente, fontes sem texto, auto-detecção)
      let queryEmbedding: number[] | null = null
      let embeddingTried = false
      async function ensureEmbedding(): Promise<number[] | null> {
        if (embeddingTried) return queryEmbedding
        embeddingTried = true
        try {
          queryEmbedding = await embedText(body.user_message.slice(0, 2000))
        } catch (embErr) {
          console.warn("[chat] Embedding falhou:", embErr)
        }
        return queryEmbedding
      }
      if (nonSessionIndexed.length > 0) await ensureEmbedding()

      // 3b. MEMÓRIA DO AGENTE — arquivos de memória indexados do agente selecionado
      // (sem isto, os arquivos enviados na aba "Memória" do agente nunca eram usados)
      if (body.agent_id) {
        try {
          const emb = await ensureEmbedding()
          if (emb) {
            // filter_company: null — os arquivos de memória do agente são gravados
            // com company nula; o agent_id já restringe ao agente correto.
            const { data: memChunks } = await admin.rpc("match_knowledge_chunks", {
              query_embedding:   `[${emb.join(",")}]`,
              match_count:       6,
              filter_company:    null,
              filter_agent_id:   body.agent_id,
              filter_source_ids: null,
              min_similarity:    0.3,
            })
            if (memChunks && memChunks.length > 0) {
              const parts = (memChunks as { title?: string | null; content: string }[])
                .map(c => `[${c.title ?? "Memória"}]\n${c.content}`)
              addSource("memória", "Memória do agente")
              system = (system ?? "") + `\n\nMEMÓRIA DO AGENTE (arquivos de conhecimento — ${parts.length} trecho(s)):\n${parts.join("\n\n---\n\n")}\n`
              void logActivity({
                userId: user.id, eventType: "source", action: "chat_agent_memory_injected",
                detail: `${parts.length} trecho(s)`, sessionId: sid as string, companyId: resolvedCompany,
              })
            }
          }
        } catch (memErr) {
          console.warn("[chat] Memória do agente falhou:", memErr)
        }
      }

      // 4+5. Injeção de conteúdo COMPLETO para fontes explicitamente selecionadas
      // Fontes selecionadas pelo usuário SEMPRE têm todo o conteúdo injetado —
      // sem depender de busca semântica, sem truncar por similaridade.
      if (sources.length > 0) {
        const TOTAL_CHAR_LIMIT = 120_000   // limite total
        const PER_SOURCE_LIMIT =  60_000   // por fonte
        const contentParts: string[] = []
        let totalChars = 0
        const sourcesWithoutContent: SourceRow[] = []

        // Passo A: fontes com conteúdo direto (coluna content ou source_files)
        for (const src of sources) {
          const fileText = (src.source_files ?? [])
            .map(f => f.extracted_text ?? "")
            .filter(Boolean)
            .join("\n\n")
          const text = src.content?.trim() || fileText.trim()

          if (!text) {
            if (src.embedding_status === "done") sourcesWithoutContent.push(src)
            continue
          }

          const remaining = TOTAL_CHAR_LIMIT - totalChars
          if (remaining <= 0) break
          const excerpt = text.slice(0, Math.min(remaining, PER_SOURCE_LIMIT))
          contentParts.push(`=== ${src.name} (${src.type}) ===\n${excerpt}`)
          totalChars += excerpt.length
        }

        // Passo B: fontes sem conteúdo direto → reconstrói via chunks em ordem
        if (sourcesWithoutContent.length > 0) {
          try {
            const { data: allChunks } = await admin
              .from("knowledge_chunks")
              .select("content, chunk_index, knowledge_source_id")
              .in("knowledge_source_id", sourcesWithoutContent.map(s => s.id))
              .is("deleted_at", null)
              .order("knowledge_source_id")
              .order("chunk_index")

            if (allChunks && allChunks.length > 0) {
              type Chunk = { content: string; chunk_index: number; knowledge_source_id: string }
              const bySource = new Map<string, string[]>()
              for (const c of allChunks as Chunk[]) {
                const arr = bySource.get(c.knowledge_source_id) ?? []
                arr.push(c.content)
                bySource.set(c.knowledge_source_id, arr)
              }

              const nameMap = new Map(sourcesWithoutContent.map(s => [s.id, `${s.name} (${s.type})`]))
              for (const [srcId, chunks] of bySource) {
                const remaining = TOTAL_CHAR_LIMIT - totalChars
                if (remaining <= 0) break
                const text = chunks.join("\n").slice(0, Math.min(remaining, PER_SOURCE_LIMIT))
                contentParts.push(`=== ${nameMap.get(srcId) ?? srcId} ===\n${text}`)
                totalChars += text.length
              }
            }
          } catch (chunkErr) {
            console.warn("[chat] Fetch de chunks falhou:", chunkErr)
          }
        }

        // Injeção única de todo o conteúdo coletado
        if (contentParts.length > 0) {
          for (const s of sources) addSource("fonte", s.name)
          system = (system ?? "") + `\n\nFONTES DE CONHECIMENTO ATIVAS (conteúdo completo):\n${contentParts.join("\n\n")}\n`
          void logActivity({
            userId: user.id, eventType: "source", action: "chat_content_injected",
            detail: `${contentParts.length} fonte(s) — ${totalChars} chars`, sessionId: sid as string, companyId: resolvedCompany,
          })
        }
      }

      // 6. Auto-detecção: busca fontes relevantes não selecionadas (threshold mais alto)
      const autoEmb = nonSessionIndexed.length > 0 ? await ensureEmbedding() : null
      if (autoEmb) {
        try {
          const { data: autoChunks } = await admin.rpc("match_knowledge_chunks", {
            query_embedding:   `[${autoEmb.join(",")}]`,
            match_count:       4,
            filter_company:    null,
            filter_companies:  companyScope,
            filter_agent_id:   null,
            filter_source_ids: nonSessionIndexed.map(s => s.id),
            min_similarity:    0.5,
          })

          if (autoChunks && autoChunks.length > 0) {
            type AutoChunk = { knowledge_source_id?: string; title?: string | null; source_type?: string | null; content: string }
            const chunkList = autoChunks as AutoChunk[]

            const sourceMap = new Map(nonSessionIndexed.map(s => [s.id, s.name]))
            const detectedIds = [...new Set(chunkList.map(c => c.knowledge_source_id).filter((id): id is string => Boolean(id)))]
            const detectedNames = detectedIds.map(id => sourceMap.get(id) ?? id)
            for (const n of detectedNames) addSource("fonte", n)

            const autoParts = chunkList.map(c => `[${c.title ?? c.source_type ?? "Auto"}]\n${c.content}`)
            system = (system ?? "")
              + `\n\nFONTES ADICIONAIS DETECTADAS AUTOMATICAMENTE (${detectedNames.join(", ")}):\n`
              + autoParts.join("\n\n---\n\n")
              + `\n\nInstrução ao assistente: mencione explicitamente ao usuário que as seguintes fontes foram identificadas automaticamente como relevantes e usadas nesta resposta: ${detectedNames.join(", ")}.\n`

            void logActivity({
              userId: user.id, eventType: "source", action: "chat_auto_detected",
              detail: detectedNames.join(", "), sessionId: sid as string, companyId: resolvedCompany,
            })
          }
        } catch (autoErr) {
          console.warn("[chat] Auto-detecção falhou:", autoErr)
        }
      }
    } catch (ctxErr) {
      console.warn("[chat] Erro ao buscar contexto de conhecimento:", ctxErr)
    }
  }

  // ─── Contexto Notion (páginas selecionadas no popup) ─────────────────────
  if (body.notion_page_ids && body.notion_page_ids.length > 0) {
    try {
      const { getNotionClientForCompany, fetchPageContent } = await import("@/lib/notion")
      const notion = await getNotionClientForCompany(resolvedCompany, { fallbackToGroup: true })
      if (notion) {
        const parts: string[] = []
        for (const pageId of body.notion_page_ids.slice(0, 5)) {
          try {
            const { title, content } = await fetchPageContent(notion, pageId)
            if (content.trim()) {
              parts.push(`=== Notion: ${title} ===\n${content.slice(0, 8_000)}`)
              addSource("notion", title)
            }
          } catch (pageErr) {
            console.warn("[chat] Notion page fetch failed:", pageId, pageErr)
          }
        }
        if (parts.length > 0) {
          system = (system ?? "") + `\n\nCONTEXTO DO NOTION:\n${parts.join("\n\n")}\n`
          void logActivity({
            userId: user.id, eventType: "source", action: "chat_notion_injected",
            detail: `${parts.length} página(s)`, sessionId: sid as string, companyId: resolvedCompany,
          })
        }
      }
    } catch (notionErr) {
      console.warn("[chat] Notion context failed:", notionErr)
    }
  }

  // ─── Memória evolutiva do Jarvis (por empresa) ───────────────────────────────
  // Recupera aprendizados acumulados desta empresa relevantes ao pedido atual.
  try {
    const { recallMemories } = await import("@/lib/jarvis-memory")
    const memories = await recallMemories(resolvedCompany, body.user_message, 5)
    if (memories.length > 0) {
      addSource("memória", "Memória do Jarvis")
      const parts = memories.map(m => `- ${m.content}`)
      system = (system ?? "")
        + `\n\nMEMÓRIA DO JARVIS (aprendizados acumulados desta empresa):\n${parts.join("\n")}\n`
      void logActivity({
        userId: user.id, eventType: "source", action: "chat_memory_recalled",
        detail: `${memories.length} memória(s)`, sessionId: sid as string, companyId: resolvedCompany,
      })
    }
  } catch (memErr) {
    console.warn("[chat] recall de memória falhou:", memErr)
  }

  // ─── Data Bricks: tool router multi-fonte ────────────────────────────────────
  // O Jarvis decide (planner Haiku) em QUAIS fontes buscar conforme o pedido e
  // executa os retrievers escolhidos. Extensível: registrar uma fonte = adicionar
  // ao array `tools` + um case no switch de execução.
  if (!body.notion_page_ids || body.notion_page_ids.length === 0) {
    try {
      const { getNotionClientForCompany, searchAndFetch } = await import("@/lib/notion")
      const notion = await getNotionClientForCompany(resolvedCompany, { fallbackToGroup: true })

      // Registry de ferramentas disponíveis para esta requisição
      const tools: { id: string; description: string }[] = [
        { id: "knowledge_base", description: "Fontes de conhecimento internas já importadas e indexadas da empresa: playbooks, fichas, cadastros, documentos, páginas do Notion salvas." },
      ]
      if (notion) {
        tools.push({ id: "notion", description: "Páginas e bases de dados do Notion da empresa, ao vivo (inclui dados ainda não importados/indexados)." })
      }

      const { routeTools } = await import("@/lib/ai/tool-router")
      const calls = await routeTools(body.user_message, tools)

      // Queries agregadas de todas as ferramentas escolhidas
      const allQueries = [...new Set(calls.flatMap(c => c.queries))]
      const wantsKnowledgeBase = calls.some(c => c.tool === "knowledge_base")

      // ── Ferramenta: base de conhecimento (RAG semântico) ──
      if (wantsKnowledgeBase && allQueries.length > 0) {
        try {
          const emb = await embedText(allQueries.join(" ").slice(0, 2000))
          const { data: chunks } = await admin.rpc("match_knowledge_chunks", {
            query_embedding:   `[${emb.join(",")}]`,
            match_count:       6,
            filter_company:    null,
            filter_companies:  companyScope,
            filter_agent_id:   null,
            filter_source_ids: null,
            min_similarity:    0.35,
          })
          if (chunks && chunks.length > 0) {
            const kbChunks = chunks as { title?: string | null; content: string }[]
            for (const c of kbChunks) if (c.title) addSource("fonte", c.title)
            const parts = kbChunks.map(c => `[${c.title ?? "Fonte"}]\n${c.content}`)
            system = (system ?? "")
              + `\n\nBASE DE CONHECIMENTO (busca: ${allQueries.join(", ")} — ${parts.length} trecho(s)):\n`
              + parts.join("\n\n---\n\n") + "\n"
            void logActivity({
              userId: user.id, eventType: "source", action: "chat_router_knowledge_base",
              detail: `${parts.length} trecho(s) — ${allQueries.join(", ")}`, sessionId: sid as string, companyId: resolvedCompany,
            })
          }
        } catch (kbErr) {
          console.warn("[chat] tool knowledge_base falhou:", kbErr)
        }
      }

      // ── Ferramenta: Notion ao vivo ──
      // Roda se o router escolheu "notion" OU se houve qualquer intenção de busca
      // e há Notion disponível (o Notion é a fonte de dados rica do grupo).
      if (notion && allQueries.length > 0) {
        try {
          const results = await searchAndFetch(notion, allQueries, { maxPages: 2, maxCharsPerPage: 12_000 })
          if (results.length > 0) {
            for (const r of results) addSource("notion", r.title)
            const parts = results.map(r => `=== Notion: ${r.title} ===\n${r.content}`)
            const names = results.map(r => r.title).join(", ")
            system = (system ?? "")
              + `\n\nDADOS ENCONTRADOS NO NOTION (busca: ${allQueries.join(", ")}):\n`
              + parts.join("\n\n")
              + `\n\nInstrução ao assistente: dados localizados automaticamente no Notion. Use-os para responder e mencione brevemente que buscou em: ${names}.\n`
            void logActivity({
              userId: user.id, eventType: "source", action: "chat_router_notion",
              detail: `${results.length} página(s) — ${allQueries.join(", ")}`, sessionId: sid as string, companyId: resolvedCompany,
            })
          }
        } catch (nErr) {
          console.warn("[chat] tool notion falhou:", nErr)
        }
      }
    } catch (routerErr) {
      console.warn("[chat] tool router falhou:", routerErr)
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
          for (const att of attachRows) addSource("anexo", att.file_name)
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

      // Transparência: informa quais fontes foram consultadas nesta resposta
      if (usedSources.length > 0) {
        controller.enqueue(sse({ type: "sources", sources: usedSources }))
      }

      // Diretriz institucional: usuários são colaboradores autorizados; usar os
      // dados já fornecidos no contexto sem recusar por privacidade, mas sem inventar.
      const institutionalDirective =
        "DIRETRIZ INSTITUCIONAL: Você atende colaboradores autorizados do Grupo Mota Educação. "
        + "Quando o contexto acima contiver dados (fontes de conhecimento, Notion, memória, anexos), "
        + "use-os diretamente para responder — inclusive dados cadastrais internos (nomes, contatos, matrículas, status). "
        + "O acesso desses colaboradores já é autorizado e auditado; não recuse por privacidade/LGPD informações que já estão no contexto fornecido. "
        + "Nunca invente dados que não estejam no contexto: se a informação não foi fornecida, diga claramente que não a encontrou nas fontes."
      const systemWithDirective = (system ? `${system}\n\n` : "") + institutionalDirective

      try {
        for await (const chunk of streamChatWithFallback({ messages: safeMessages, system: systemWithDirective, provider, model })) {

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
