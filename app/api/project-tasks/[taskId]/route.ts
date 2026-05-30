import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope"
import { logActivity } from "@/lib/activity-logger"
import { mapTask, refreshProjectCounts } from "@/lib/project-helpers"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ taskId: string }> }

async function getTaskAndAuth(taskId: string, userId: string) {
  const admin = createAdminClient()
  const { data: task } = await admin
    .from("tasks").select("*, projects(company_id, title)").eq("id", taskId).single()
  if (!task) return { task: null, admin, projectCompanyId: null, allowed: false }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectCompanyId = (task as any).projects?.company_id as string | null

  const [isAdmin, allowed] = await Promise.all([isGlobalAdmin(userId), getAllowedCompanyIds(userId)])
  const hasAccess = isAdmin || (!!projectCompanyId && allowed.includes(projectCompanyId as never))

  return { task, admin, projectCompanyId, allowed: hasAccess }
}

// ─── GET — detalhes da tarefa ─────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { taskId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { task, allowed } = await getTaskAndAuth(taskId, user.id)
  if (!task) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 })
  if (!allowed) return NextResponse.json({ error: "Sem acesso" }, { status: 403 })

  return NextResponse.json(mapTask(task))
}

// ─── PATCH — atualizar / concluir / reabrir tarefa ───────────────────────────

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { taskId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { task, admin, projectCompanyId, allowed } = await getTaskAndAuth(taskId, user.id)
  if (!task) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 })
  if (!allowed) return NextResponse.json({ error: "Sem acesso" }, { status: 403 })

  const body = await req.json() as Record<string, unknown>
  const updates: Record<string, unknown> = {}

  if (body.title       !== undefined) updates.title       = String(body.title).trim()
  if (body.description !== undefined) updates.description = body.description
  if (body.priority    !== undefined) updates.priority    = body.priority
  if (body.assignee_id !== undefined) updates.assignee_id = body.assignee_id
  if (body.due_date    !== undefined) updates.due_date    = body.due_date
  if (body.status      !== undefined) {
    updates.status = body.status
    if (body.status === "done" && task.status !== "done") {
      updates.completed_at = new Date().toISOString()
    } else if (body.status !== "done") {
      updates.completed_at = null
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 })
  }

  const { data, error } = await admin
    .from("tasks").update(updates).eq("id", taskId).select().single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void refreshProjectCounts(admin, task.project_id)

  void logActivity({
    userId: user.id, eventType: "settings",
    action: "Tarefa atualizada", detail: task.title,
    companyId: projectCompanyId ?? undefined,
  })

  return NextResponse.json(mapTask(data))
}

// ─── DELETE — arquivar tarefa ─────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { taskId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { task, admin, projectCompanyId, allowed } = await getTaskAndAuth(taskId, user.id)
  if (!task) return NextResponse.json({ error: "Tarefa não encontrada" }, { status: 404 })
  if (!allowed) return NextResponse.json({ error: "Sem acesso" }, { status: 403 })

  const { error } = await admin.from("tasks").update({ archived: true }).eq("id", taskId)
  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void refreshProjectCounts(admin, task.project_id)

  void logActivity({
    userId: user.id, eventType: "settings",
    action: "Tarefa arquivada", detail: task.title,
    companyId: projectCompanyId ?? undefined,
  })

  return NextResponse.json({ ok: true })
}
