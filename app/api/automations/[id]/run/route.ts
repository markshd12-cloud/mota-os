import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { streamChat }        from "@/lib/ai-service"
import { buildWorkflowPrompt } from "@/lib/workflow-prompts"
import { workflows }           from "@/lib/mocks/workflows"
import { rateLimit, RATE_LIMITS, rateLimitJsonResponse } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

function calcNextRun(frequency: string): string | null {
  const now = new Date()
  switch (frequency) {
    case "daily":   now.setDate(now.getDate() + 1);   return now.toISOString()
    case "weekly":  now.setDate(now.getDate() + 7);   return now.toISOString()
    case "monthly": now.setMonth(now.getMonth() + 1); return now.toISOString()
    default:        return null
  }
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // ─── Rate limiting ────────────────────────────────────────────────────────
  const rl = rateLimit(`automation:${user.id}`, RATE_LIMITS.automation)
  if (!rl.ok) return rateLimitJsonResponse(rl.resetAt)

  const admin = createAdminClient()

  const { data: automation, error: aErr } = await admin
    .from("automations")
    .select("*")
    .eq("id", id)
    .eq("created_by", user.id)
    .single()

  if (aErr || !automation) {
    return NextResponse.json({ error: "Automação não encontrada" }, { status: 404 })
  }

  const workflow = workflows.find((w) => w.id === automation.workflow_id)
  if (!workflow) {
    return NextResponse.json({ error: "Workflow não encontrado" }, { status: 404 })
  }

  const config = (automation.config ?? {}) as {
    values?: Record<string, string | string[]>
    context?: string
  }

  const { data: runRow, error: runErr } = await admin
    .from("automation_runs")
    .insert({
      automation_id: automation.id,
      status:        "running",
      input:         config.values ?? {},
    })
    .select("id")
    .single()

  if (runErr || !runRow) {
    return NextResponse.json({ error: "Erro ao criar log" }, { status: 500 })
  }
  const runId = runRow.id as string

  const { system, user: userPrompt } = buildWorkflowPrompt(
    workflow.name,
    workflow.steps,
    config.values ?? {},
  )

  const fullPrompt = config.context
    ? `${userPrompt}\n\nContexto adicional: ${config.context}`
    : userPrompt

  let output = ""
  let errorMsg: string | null = null
  const startedAt = Date.now()

  try {
    for await (const chunk of streamChat({
      messages: [{ role: "user", content: fullPrompt }],
      system,
    })) {
      if (!chunk.done) {
        output += chunk.text
      } else if ("error" in chunk) {
        errorMsg = chunk.error
      }
    }
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : "Erro interno"
  }

  const finishedAt = new Date().toISOString()
  const status     = errorMsg ? "error" : "done"

  await Promise.all([
    admin.from("automation_runs").update({
      status,
      output:        errorMsg ? null  : output,
      error_message: errorMsg ?? null,
      finished_at:   finishedAt,
    }).eq("id", runId),

    admin.from("automations").update({
      last_run_at: finishedAt,
      next_run_at: calcNextRun(automation.frequency),
      updated_at:  finishedAt,
    }).eq("id", automation.id),
  ])

  if (errorMsg) {
    return NextResponse.json({ error: errorMsg }, { status: 500 })
  }

  return NextResponse.json({
    ok:          true,
    run_id:      runId,
    output,
    duration_ms: Date.now() - startedAt,
    next_run_at: calcNextRun(automation.frequency),
  })
}
