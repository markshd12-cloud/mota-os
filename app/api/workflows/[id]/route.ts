import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { logActivity }       from "@/lib/activity-logger"
import { getAllowedCompanyIds } from "@/lib/company-scope"

export const dynamic = "force-dynamic"

// ─── helpers ──────────────────────────────────────────────────────────────────

async function fetchWorkflow(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data, error } = await admin
    .from("workflows")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single()
  return { data, error }
}

async function canAccess(userId: string, companyId: string | null): Promise<boolean> {
  if (!companyId) return true // global
  const allowed = await getAllowedCompanyIds(userId)
  return (allowed as string[]).includes(companyId)
}

// ─── GET — detalhes do workflow ───────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await fetchWorkflow(admin, id)
  if (error || !data) return NextResponse.json({ error: "Workflow não encontrado" }, { status: 404 })

  if (!await canAccess(user.id, data.company_id as string | null)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  return NextResponse.json({ workflow: data })
}

// ─── PATCH — atualizar workflow ───────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: existing, error: fetchErr } = await fetchWorkflow(admin, id)
  if (fetchErr || !existing) return NextResponse.json({ error: "Workflow não encontrado" }, { status: 404 })

  if (!await canAccess(user.id, existing.company_id as string | null)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const body = await req.json() as {
    name?:             string
    description?:      string
    category?:         string
    status?:           string
    input_schema?:     unknown[]
    steps?:            unknown[]
    prompt_template?:  string | null
    default_agent_id?: string | null
    output_type?:      string
    metadata?:         Record<string, unknown>
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name            !== undefined) patch.name             = body.name.trim()
  if (body.description     !== undefined) patch.description      = body.description?.trim() ?? null
  if (body.category        !== undefined) { patch.category = body.category; patch.area = body.category }
  if (body.status          !== undefined) patch.status           = body.status
  if (body.input_schema    !== undefined) patch.input_schema     = body.input_schema
  if (body.steps           !== undefined) patch.steps            = body.steps
  if (body.prompt_template !== undefined) patch.prompt_template  = body.prompt_template
  if (body.default_agent_id !== undefined) patch.default_agent_id = body.default_agent_id
  if (body.output_type     !== undefined) patch.output_type      = body.output_type
  if (body.metadata        !== undefined) patch.metadata         = body.metadata

  const { data, error } = await admin
    .from("workflows")
    .update(patch)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "workflow",
    action:    "workflow_updated",
    detail:    data.name as string,
    metadata:  { workflow_id: id },
    companyId: (existing.company_id as string | null) ?? undefined,
  })

  return NextResponse.json({ workflow: data })
}

// ─── DELETE — soft delete ─────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: existing, error: fetchErr } = await fetchWorkflow(admin, id)
  if (fetchErr || !existing) return NextResponse.json({ error: "Workflow não encontrado" }, { status: 404 })

  if (!await canAccess(user.id, existing.company_id as string | null)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  await admin
    .from("workflows")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)

  void logActivity({
    userId:    user.id,
    eventType: "workflow",
    action:    "workflow_deleted",
    detail:    existing.name as string,
    metadata:  { workflow_id: id },
    companyId: (existing.company_id as string | null) ?? undefined,
  })

  return NextResponse.json({ ok: true })
}
