import { NextRequest } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { streamChat }        from "@/lib/ai-service"
import { buildWorkflowPrompt, companyToSlug } from "@/lib/workflow-prompts"
import type { WorkflowStep } from "@/lib/workflow-types"

export const dynamic = "force-dynamic"

function sse(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    workflow_slug: string
    workflow_name: string
    steps:         WorkflowStep[]
    values:        Record<string, string | string[]>
    company_id?:   string
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: "Sessão expirada. Faça login novamente." })}\n\n`,
      { status: 401, headers: { "Content-Type": "text/event-stream" } },
    )
  }

  const admin      = createAdminClient()
  const company_id = body.company_id
    ?? companyToSlug((body.values["empresa"] as string) ?? "")
    ?? "grupo"

  // ─── Criar registro no banco com status "running" ─────────────────────────
  const startedAt = Date.now()
  const { data: run, error: runErr } = await admin
    .from("workflow_runs")
    .insert({
      user_id:       user.id,
      workflow_id:   null,
      workflow_slug: body.workflow_slug,
      workflow_name: body.workflow_name,
      company_id,
      values:        body.values,
      status:        "running",
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

  // ─── Construir prompt ─────────────────────────────────────────────────────
  const { system, user: userPrompt } = buildWorkflowPrompt(
    body.workflow_name,
    body.steps,
    body.values,
  )

  // ─── Stream ───────────────────────────────────────────────────────────────
  const readable = new ReadableStream({
    async start(controller) {
      let accumulated = ""

      try {
        for await (const chunk of streamChat({
          messages: [{ role: "user", content: userPrompt }],
          system,
        })) {
          if (!chunk.done) {
            accumulated += chunk.text
            controller.enqueue(sse({ type: "delta", text: chunk.text }))

          } else if ("error" in chunk) {
            await admin.from("workflow_runs").update({
              status:        "error",
              error_message: chunk.error,
              completed_at:  new Date().toISOString(),
              duration_ms:   Date.now() - startedAt,
            }).eq("id", runId)

            controller.enqueue(sse({ type: "error", error: chunk.error }))

          } else {
            await admin.from("workflow_runs").update({
              status:        "done",
              result:        accumulated,
              completed_at:  new Date().toISOString(),
              duration_ms:   Date.now() - startedAt,
            }).eq("id", runId)

            controller.enqueue(sse({
              type:    "done",
              run_id:  runId,
              model:   chunk.model,
              provider: chunk.provider,
              usage:   chunk.usage,
            }))
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro interno"
        await admin.from("workflow_runs").update({
          status:        "error",
          error_message: msg,
          completed_at:  new Date().toISOString(),
          duration_ms:   Date.now() - startedAt,
        }).eq("id", runId)

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
