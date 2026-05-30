import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { getAllowedCompanyIds, getCurrentCompany } from "@/lib/company-scope"
import { logActivity }       from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    name?:        string
    description?: string
    type?:        string
    company_id?:  string
  }

  const admin = createAdminClient()

  // Buscar execução
  const { data: run, error: runErr } = await admin
    .from("workflow_runs")
    .select("id, workflow_id, workflow_name, company_id, user_id, output, result, status")
    .eq("id", id)
    .single()

  if (runErr || !run) {
    return NextResponse.json({ error: "Execução não encontrada" }, { status: 404 })
  }

  if (run.status !== "completed" && run.status !== "done") {
    return NextResponse.json({ error: "A execução ainda não foi concluída" }, { status: 422 })
  }

  // Verificar acesso
  const runCompany = (run.company_id as string | null)
  if (runCompany) {
    const allowed = await getAllowedCompanyIds(user.id)
    if (!(allowed as string[]).includes(runCompany)) {
      return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
    }
  } else if ((run.user_id as string) !== user.id) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const content    = (run.output ?? run.result ?? "") as string
  const wfName     = (run.workflow_name as string | null) ?? "Workflow"
  const companyId  = body.company_id ?? runCompany ?? await getCurrentCompany(user.id)

  if (!companyId) {
    return NextResponse.json({ error: "Empresa não identificada para salvar a fonte" }, { status: 422 })
  }

  const sourceName = body.name?.trim() || `[${wfName}] ${new Date().toLocaleDateString("pt-BR")}`

  const { data: source, error: sourceErr } = await admin
    .from("knowledge_sources")
    .insert({
      company_id:  companyId,
      name:        sourceName,
      description: body.description?.trim() || `Gerado pelo workflow "${wfName}" via Jarvis`,
      type:        body.type ?? "document",
      status:      "active",
      content,
      created_by:  user.id,
      metadata:    {
        workflow_run_id: id,
        workflow_name:   wfName,
        source:          "workflow_output",
      },
    })
    .select("id, name")
    .single()

  if (sourceErr) {
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  }

  void logActivity({
    userId:    user.id,
    eventType: "workflow",
    action:    "workflow_output_saved_as_source",
    detail:    sourceName,
    metadata:  {
      workflow_run_id: id,
      workflow_name:   wfName,
      source_id:       source.id,
    },
    companyId: companyId ?? undefined,
  })

  return NextResponse.json({ ok: true, source_id: source.id, name: source.name }, { status: 201 })
}
