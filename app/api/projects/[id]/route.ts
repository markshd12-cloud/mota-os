import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope"
import { logActivity }       from "@/lib/activity-logger"
import { mapProject, buildProjectUpdates } from "@/lib/project-helpers"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

// ─── GET — detalhes do projeto ────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("projects")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error || !data) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 })

  const [isAdmin, allowed] = await Promise.all([isGlobalAdmin(user.id), getAllowedCompanyIds(user.id)])
  if (!isAdmin && !allowed.includes(data.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  return NextResponse.json(mapProject(data))
}

// ─── PATCH — atualizar projeto ────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("projects").select("company_id, title").eq("id", id).is("deleted_at", null).single()
  if (!existing) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 })

  const [isAdmin, allowed] = await Promise.all([isGlobalAdmin(user.id), getAllowedCompanyIds(user.id)])
  if (!isAdmin && !allowed.includes(existing.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const body = await req.json() as Record<string, unknown>
  const updates = buildProjectUpdates(body)

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 })
  }

  const { data, error } = await admin
    .from("projects")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId: user.id, eventType: "settings",
    action: "Projeto atualizado", detail: existing.title, companyId: existing.company_id,
  })

  return NextResponse.json(mapProject(data))
}

// ─── DELETE — soft delete do projeto ─────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("projects").select("company_id, title").eq("id", id).is("deleted_at", null).single()
  if (!existing) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 })

  const [isAdmin, allowed] = await Promise.all([isGlobalAdmin(user.id), getAllowedCompanyIds(user.id)])
  if (!isAdmin && !allowed.includes(existing.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const { error } = await admin
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId: user.id, eventType: "settings",
    action: "Projeto excluído", detail: existing.title, companyId: existing.company_id,
  })

  return NextResponse.json({ ok: true })
}
