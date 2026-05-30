import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope"
import { logActivity } from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

// ─── GET — fonte específica ───────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("knowledge_sources")
    .select("*")
    .eq("id", id)
    .single()

  if (error || !data) return NextResponse.json({ error: "Não encontrada" }, { status: 404 })

  const [admin_, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!admin_ && !allowed.includes(data.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  return NextResponse.json(data)
}

// ─── PATCH — editar fonte ─────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("knowledge_sources")
    .select("company_id, name")
    .eq("id", id)
    .single()

  if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 })

  const [admin_, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!admin_ && !allowed.includes(existing.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const body = await req.json() as Record<string, unknown>
  const ALLOWED_FIELDS = ["name","description","content","type","status","metadata"]
  const updates: Record<string, unknown> = {}
  for (const k of ALLOWED_FIELDS) {
    if (body[k] !== undefined) updates[k] = body[k]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 })
  }

  const { data, error } = await admin
    .from("knowledge_sources")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Fonte atualizada (by id)",
    detail:    existing.name,
    companyId: existing.company_id,
  })

  return NextResponse.json(data)
}

// ─── DELETE — arquivar fonte ──────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("knowledge_sources")
    .select("company_id, name")
    .eq("id", id)
    .single()

  if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 })

  const [admin_, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!admin_ && !allowed.includes(existing.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const { error } = await admin
    .from("knowledge_sources")
    .update({ status: "archived" })
    .eq("id", id)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Fonte arquivada",
    detail:    existing.name,
    companyId: existing.company_id,
  })

  return NextResponse.json({ ok: true })
}
