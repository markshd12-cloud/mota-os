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
    title?:      string
    priority?:   string
    company_id?: string
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

  const content    = ((run.output ?? run.result ?? "") as string).slice(0, 2000)
  const wfName     = (run.workflow_name as string | null) ?? "Workflow"
  const companyId  = body.company_id ?? runCompany ?? await getCurrentCompany(user.id)
  const date       = new Date().toLocaleDateString("pt-BR")
  const taskTitle  = body.title?.trim() || `[${wfName}] ${date}`
  const priority   = (body.priority as string | undefined) ?? "media"

  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .insert({
      title:       taskTitle,
      description: content,
      status:      "todo",
      priority,
      tags:        [wfName],
      position:    0,
      company_id:  companyId ?? null,
    })
    .select("id, title")
    .single()

  if (taskErr) {
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  }

  void logActivity({
    userId:    user.id,
    eventType: "workflow",
    action:    "workflow_output_saved_as_task",
    detail:    taskTitle,
    metadata:  {
      workflow_run_id: id,
      workflow_name:   wfName,
      task_id:         task.id,
    },
    companyId: companyId ?? undefined,
  })

  return NextResponse.json({ ok: true, task_id: task.id, title: task.title }, { status: 201 })
}
