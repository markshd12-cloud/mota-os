import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope"
import { logActivity }       from "@/lib/activity-logger"
import { mapTask }           from "@/lib/project-helpers"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

// ─── GET — listar tarefas do projeto ─────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: project } = await admin
    .from("projects").select("company_id").eq("id", id).is("deleted_at", null).single()
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 })

  const [isAdmin, allowed] = await Promise.all([isGlobalAdmin(user.id), getAllowedCompanyIds(user.id)])
  if (!isAdmin && !allowed.includes(project.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const { data, error } = await admin
    .from("tasks")
    .select("*")
    .eq("project_id", id)
    .eq("archived", false)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json((data ?? []).map(mapTask))
}

// ─── POST — criar tarefa ──────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: project } = await admin
    .from("projects").select("company_id, title").eq("id", id).is("deleted_at", null).single()
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 })

  const [isAdmin, allowed] = await Promise.all([isGlobalAdmin(user.id), getAllowedCompanyIds(user.id)])
  if (!isAdmin && !allowed.includes(project.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const body = await req.json() as {
    title?:       string
    description?: string
    status?:      string
    priority?:    string
    assignee_id?: string | null
    due_date?:    string | null
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title obrigatório" }, { status: 400 })
  }

  const { data, error } = await admin
    .from("tasks")
    .insert({
      project_id:  id,
      company_id:  project.company_id,
      title:       body.title.trim(),
      description: body.description ?? "",
      status:      body.status ?? "todo",
      priority:    body.priority ?? "media",
      assignee_id: body.assignee_id ?? null,
      due_date:    body.due_date ?? null,
      created_by:  user.id,
      archived:    false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  // Atualiza contagens no projeto em background
  const { refreshProjectCounts } = await import("@/lib/project-helpers")
  void refreshProjectCounts(admin, id)

  void logActivity({
    userId: user.id, eventType: "settings",
    action: "Tarefa criada", detail: `${body.title.trim()} → ${project.title}`, companyId: project.company_id,
  })

  return NextResponse.json(mapTask(data), { status: 201 })
}
