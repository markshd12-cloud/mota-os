import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { getAllowedCompanyIds } from "@/lib/company-scope"
import { parseBody, taskCreateSchema, taskPatchSchema, taskDeleteSchema } from "@/lib/validators"
import { NextRequest, NextResponse } from "next/server"

async function assertProjectAccess(projectId: string | undefined, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!projectId) return { ok: true } // task sem projeto explícito
  const admin = createAdminClient()
  const { data: project } = await admin
    .from("projects")
    .select("company_id")
    .eq("id", projectId)
    .maybeSingle()

  if (!project) return { ok: false, error: "Projeto não encontrado" }

  const allowed = await getAllowedCompanyIds(userId)
  if (!allowed.includes(project.company_id as never)) {
    return { ok: false, error: "Sem acesso ao projeto desta empresa" }
  }
  return { ok: true }
}

async function loadTaskWithCompanyCheck(taskId: string, userId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  const { data: task } = await admin
    .from("tasks")
    .select("id, project_id, assignee_id")
    .eq("id", taskId)
    .maybeSingle()

  if (!task) return { ok: false, status: 404, error: "Task não encontrada" }

  // Caso 1: usuário é o assignee
  if (task.assignee_id === userId) return { ok: true }

  // Caso 2: task tem projeto e o projeto pertence a uma empresa que o user vê
  if (task.project_id) {
    const check = await assertProjectAccess(task.project_id, userId)
    if (check.ok) return { ok: true }
  }

  return { ok: false, status: 403, error: "Sem permissão sobre esta task" }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const parsed = await parseBody(req, taskCreateSchema)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const body = parsed.data

  if (body.project_id) {
    const check = await assertProjectAccess(body.project_id, user.id)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("tasks")
    .insert(body)
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro ao criar task" }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const parsed = await parseBody(req, taskPatchSchema)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { id, ...patch } = parsed.data
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 })
  }

  const access = await loadTaskWithCompanyCheck(id, user.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  if (patch.project_id) {
    const check = await assertProjectAccess(patch.project_id, user.id)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("tasks")
    .update(patch)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro ao atualizar task" }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const parsed = await parseBody(req, taskDeleteSchema)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { id, archive } = parsed.data

  const access = await loadTaskWithCompanyCheck(id, user.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const admin = createAdminClient()

  if (archive) {
    const { error } = await admin
      .from("tasks")
      .update({ archived: true })
      .eq("id", id)
    if (error) return NextResponse.json({ error: "Erro ao arquivar" }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const { error } = await admin.from("tasks").delete().eq("id", id)
  if (error) return NextResponse.json({ error: "Erro ao deletar" }, { status: 500 })
  return NextResponse.json({ ok: true })
}
