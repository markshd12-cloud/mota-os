import { NextRequest } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { streamChat }        from "@/lib/ai-service"
import { logActivity }       from "@/lib/activity-logger"
import { getAllowedCompanyIds, getCurrentCompany } from "@/lib/company-scope"
import { buildWorkflowPrompt } from "@/lib/workflow-prompts"
import { embedText }           from "@/lib/rag/embeddings"
import type { WorkflowStep } from "@/lib/workflow-types"
import { rateLimit, RATE_LIMITS, rateLimitSseResponse } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

function sse(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

// Substitui {{variavel}} no template pelo valor do input
function interpolatePrompt(
  template: string,
  input: Record<string, string | string[]>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = input[key]
    if (!val) return `[${key} não informado]`
    return Array.isArray(val) ? val.join(", ") : val
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Sessão expirada. Faça login novamente." })}\n\n`,
      { status: 401, headers: { "Content-Type": "text/event-stream" } },
    )
  }

  // ─── Rate limiting ────────────────────────────────────────────────────────
  const rl = rateLimit(`workflow:${user.id}`, RATE_LIMITS.default)
  if (!rl.ok) return rateLimitSseResponse(rl.resetAt)

  const body = await req.json() as {
    input?:      Record<string, string | string[]>
    agent_id?:   string
    company_id?: string
  }

  const admin = createAdminClient()

  // Buscar workflow
  const { data: wf, error: wfErr } = await admin
    .from("workflows")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (wfErr || !wf) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Workflow não encontrado" })}\n\n`,
      { status: 404, headers: { "Content-Type": "text/event-stream" } },
    )
  }

  // Validar acesso à empresa do workflow
  const wfCompany = wf.company_id as string | null
  if (wfCompany) {
    const allowed = await getAllowedCompanyIds(user.id)
    if (!(allowed as string[]).includes(wfCompany)) {
      return new Response(
        `data: ${JSON.stringify({ type: "error", error: "Sem acesso a este workflow" })}\n\n`,
        { status: 403, headers: { "Content-Type": "text/event-stream" } },
      )
    }
  }

  const company = body.company_id
    ?? wfCompany
    ?? await getCurrentCompany(user.id)

  const input = body.input ?? {}

  // Buscar config do agente (se houver)
  const agentId = body.agent_id ?? (wf.default_agent_id as string | null) ?? null
  let agentProvider: string | undefined
  let agentModel:    string | undefined
  let agentSystem:   string | undefined

  if (agentId) {
    const { data: modelCfg } = await admin
      .from("agent_model_configs")
      .select("provider, model_id, system_prompt")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (modelCfg) {
      agentProvider = (modelCfg.provider as string) ?? undefined
      agentModel    = (modelCfg.model_id as string) ?? undefined
      agentSystem   = (modelCfg.system_prompt as string) ?? undefined
    }
  }

  // Construir prompt
  let systemPrompt: string
  let userPrompt:   string

  if (wf.prompt_template) {
    systemPrompt = agentSystem ??
      "Você é um assistente especializado do Grupo Mota Educação. Responda em português, seja objetivo e entregue resultados estruturados."
    userPrompt = interpolatePrompt(wf.prompt_template as string, input)
  } else {
    const built = buildWorkflowPrompt(
      wf.name as string,
      (wf.steps as WorkflowStep[]) ?? [],
      input,
    )
    systemPrompt = agentSystem ?? built.system
    userPrompt   = built.user
  }

  // ── Injetar contexto RAG (best-effort — nunca bloqueia o workflow) ──────────
  if (company) {
    try {
      const searchQuery = userPrompt.slice(0, 1500)
      const queryEmbedding = await embedText(searchQuery)

      const { data: chunks } = await admin.rpc("match_knowledge_chunks", {
        query_embedding:   `[${queryEmbedding.join(",")}]`,
        match_count:       5,
        filter_company:    company,
        filter_agent_id:   agentId,
        filter_source_ids: null,
        min_similarity:    0.40,
      })

      if (chunks && (chunks as unknown[]).length > 0) {
        const parts = (chunks as { title?: string | null; content: string }[])
          .map(c => `[${c.title ?? "Fonte"}]\n${c.content}`)
        systemPrompt += `\n\nFONTES DE CONHECIMENTO RELEVANTES:\n${parts.join("\n\n---\n\n")}\n`
      }
    } catch {
      // Falha de RAG nunca bloqueia a execução do workflow
    }
  }

  // Criar registro no banco com status "running"
  const startedAt = Date.now()
  const { data: run, error: runErr } = await admin
    .from("workflow_runs")
    .insert({
      workflow_id:   id,
      workflow_name: wf.name as string,
      company_id:    company,
      user_id:       user.id,
      agent_id:      agentId,
      status:        "running",
      input,
      values:        input, // legado
      started_at:    new Date().toISOString(),
    })
    .select("id")
    .single()

  if (runErr || !run) {
    const msg = runErr?.message ?? "Erro ao criar registro"
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: msg })}\n\n`,
      { status: 500, headers: { "Content-Type": "text/event-stream" } },
    )
  }

  const runId = run.id as string

  void logActivity({
    userId:    user.id,
    eventType: "workflow",
    action:    "workflow_run_started",
    detail:    wf.name as string,
    metadata:  { workflow_id: id, run_id: runId },
    companyId: company ?? undefined,
  })

  // SSE streaming
  const readable = new ReadableStream({
    async start(controller) {
      let accumulated = ""

      try {
        for await (const chunk of streamChat({
          messages: [{ role: "user", content: userPrompt }],
          system:   systemPrompt,
          provider: agentProvider as "anthropic" | "openai" | undefined,
          model:    agentModel,
        })) {
          if (!chunk.done) {
            accumulated += chunk.text
            controller.enqueue(sse({ type: "delta", text: chunk.text }))

          } else if ("error" in chunk) {
            await admin.from("workflow_runs").update({
              status:        "failed",
              error_message: chunk.error,
              completed_at:  new Date().toISOString(),
              duration_ms:   Date.now() - startedAt,
            }).eq("id", runId)

            void logActivity({
              userId:    user.id,
              eventType: "workflow",
              action:    "workflow_run_failed",
              detail:    chunk.error,
              metadata:  { workflow_id: id, run_id: runId },
              companyId: company ?? undefined,
            })

            controller.enqueue(sse({ type: "error", error: chunk.error }))

          } else {
            await admin.from("workflow_runs").update({
              status:        "completed",
              result:        accumulated,
              output:        accumulated,
              provider:      chunk.provider,
              model_used:    chunk.model,
              input_tokens:  chunk.usage.input_tokens,
              output_tokens: chunk.usage.output_tokens,
              completed_at:  new Date().toISOString(),
              duration_ms:   Date.now() - startedAt,
            }).eq("id", runId)

            void logActivity({
              userId:    user.id,
              eventType: "workflow",
              action:    "workflow_run_completed",
              detail:    wf.name as string,
              metadata:  {
                workflow_id:   id,
                run_id:        runId,
                provider:      chunk.provider,
                model:         chunk.model,
                input_tokens:  chunk.usage.input_tokens,
                output_tokens: chunk.usage.output_tokens,
              },
              companyId: company ?? undefined,
            })

            controller.enqueue(sse({
              type:     "done",
              run_id:   runId,
              model:    chunk.model,
              provider: chunk.provider,
              usage:    chunk.usage,
            }))
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro interno"
        await admin.from("workflow_runs").update({
          status:        "failed",
          error_message: msg,
          completed_at:  new Date().toISOString(),
          duration_ms:   Date.now() - startedAt,
        }).eq("id", runId)

        void logActivity({
          userId:    user.id,
          eventType: "workflow",
          action:    "workflow_run_failed",
          detail:    msg,
          metadata:  { workflow_id: id, run_id: runId },
          companyId: company ?? undefined,
        })

        controller.enqueue(sse({ type: "error", error: msg }))
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
    },
  })
}
