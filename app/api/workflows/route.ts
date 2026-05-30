import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { logActivity }       from "@/lib/activity-logger"
import { getCurrentCompany, getAllowedCompanyIds } from "@/lib/company-scope"

export const dynamic = "force-dynamic"

// ─── GET — listar workflows da empresa ativa + globais ────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const companyParam = searchParams.get("company_id")

  const admin   = createAdminClient()
  const company = companyParam ?? await getCurrentCompany(user.id)

  // Buscar workflows: globais (company_id IS NULL) + da empresa ativa
  const { data: workflows, error } = await admin
    .from("workflows")
    .select("*")
    .or(`company_id.is.null,company_id.eq.${company}`)
    .is("deleted_at", null)
    .neq("status", "archived")
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  // Agregar contagem de runs por workflow
  const wfIds = (workflows ?? []).map((w) => w.id as string)
  const runStats: Record<string, { run_count: number; last_run_at: string | null }> = {}

  if (wfIds.length > 0) {
    const { data: runs } = await admin
      .from("workflow_runs")
      .select("workflow_id, created_at")
      .in("workflow_id", wfIds)
      .order("created_at", { ascending: false })

    for (const run of runs ?? []) {
      const wid = run.workflow_id as string
      if (!runStats[wid]) {
        runStats[wid] = { run_count: 0, last_run_at: run.created_at as string }
      }
      runStats[wid].run_count++
    }
  }

  const enriched = (workflows ?? []).map((w) => ({
    ...w,
    run_count:   runStats[w.id as string]?.run_count   ?? 0,
    last_run_at: runStats[w.id as string]?.last_run_at ?? null,
  }))

  return NextResponse.json({ workflows: enriched, company_id: company })
}

// ─── POST — criar workflow ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    name:              string
    description?:      string
    category?:         string
    company_id?:       string | null
    status?:           string
    input_schema?:     unknown[]
    steps?:            unknown[]
    prompt_template?:  string
    default_agent_id?: string | null
    output_type?:      string
    metadata?:         Record<string, unknown>
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name é obrigatório" }, { status: 400 })
  }

  const admin = createAdminClient()

  // Validar acesso à empresa (se não global)
  if (body.company_id) {
    const allowed = await getAllowedCompanyIds(user.id)
    if (!allowed.includes(body.company_id as never)) {
      return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
    }
  }

  const company = body.company_id !== undefined
    ? body.company_id
    : await getCurrentCompany(user.id)

  const { data, error } = await admin
    .from("workflows")
    .insert({
      name:             body.name.trim(),
      description:      body.description?.trim() ?? null,
      category:         body.category ?? null,
      area:             body.category ?? null,
      company_id:       company,
      status:           body.status ?? "active",
      input_schema:     body.input_schema ?? [],
      steps:            body.steps ?? [],
      prompt_template:  body.prompt_template?.trim() ?? null,
      default_agent_id: body.default_agent_id ?? null,
      output_type:      body.output_type ?? "text",
      metadata:         body.metadata ?? {},
      created_by:       user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "workflow",
    action:    "workflow_created",
    detail:    body.name.trim(),
    metadata:  { workflow_id: data.id, company_id: company },
    companyId: company ?? undefined,
  })

  return NextResponse.json({ workflow: data }, { status: 201 })
}
