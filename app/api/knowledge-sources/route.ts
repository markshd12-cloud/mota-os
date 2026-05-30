import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds, ALL_SLUGS } from "@/lib/company-scope"
import { logActivity } from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

const VALID_TYPES = [
  "playbook","faq","script","product_info","brand_voice",
  "offer","objection","competitor","internal_process",
  "document","link","manual_note",
] as const
type KnowledgeType = typeof VALID_TYPES[number]

function isValidType(t: string): t is KnowledgeType {
  return (VALID_TYPES as readonly string[]).includes(t)
}

// ─── GET — listar fontes de uma empresa ──────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get("company_id")
  const typeFilter = searchParams.get("type")

  if (!companyId || !(ALL_SLUGS as string[]).includes(companyId)) {
    return NextResponse.json({ error: "company_id obrigatório e válido" }, { status: 400 })
  }

  const [admin_, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!admin_ && !allowed.includes(companyId as typeof ALL_SLUGS[number])) {
    return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
  }

  const admin = createAdminClient()
  let q = admin
    .from("knowledge_sources")
    .select("id, company_id, name, description, type, status, content, metadata, created_by, created_at, updated_at")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("created_at", { ascending: false })

  if (typeFilter && isValidType(typeFilter)) {
    q = q.eq("type", typeFilter)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// ─── POST — criar fonte ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    company_id?:  string
    name?:        string
    type?:        string
    description?: string
    content?:     string
    metadata?:    Record<string, unknown>
  }

  const { company_id, name, type, description = "", content = "", metadata = {} } = body

  if (!company_id || !(ALL_SLUGS as string[]).includes(company_id)) {
    return NextResponse.json({ error: "company_id inválido" }, { status: 400 })
  }
  if (!name?.trim()) {
    return NextResponse.json({ error: "name obrigatório" }, { status: 400 })
  }
  if (!type || !isValidType(type)) {
    return NextResponse.json({ error: `type inválido. Valores aceitos: ${VALID_TYPES.join(", ")}` }, { status: 400 })
  }

  const [admin_, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!admin_ && !allowed.includes(company_id as typeof ALL_SLUGS[number])) {
    return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("knowledge_sources")
    .insert({
      company_id,
      name:        name.trim(),
      type,
      description,
      content,
      metadata,
      created_by:  user.id,
      status:      "active",
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Fonte de conhecimento criada",
    detail:    `${name.trim()} (${type}) → ${company_id}`,
    companyId: company_id,
  })

  return NextResponse.json(data, { status: 201 })
}

// ─── PATCH — editar fonte ─────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    id?:          string
    name?:        string
    description?: string
    content?:     string
    type?:        string
    status?:      string
    metadata?:    Record<string, unknown>
  }

  if (!body.id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("knowledge_sources")
    .select("company_id, name")
    .eq("id", body.id)
    .single()

  if (!existing) return NextResponse.json({ error: "Fonte não encontrada" }, { status: 404 })

  const [admin_, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!admin_ && !allowed.includes(existing.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const updates: Record<string, unknown> = {}
  if (body.name        !== undefined) updates.name        = body.name.trim()
  if (body.description !== undefined) updates.description = body.description
  if (body.content     !== undefined) updates.content     = body.content
  if (body.type        !== undefined && isValidType(body.type)) updates.type = body.type
  if (body.status      === "archived" || body.status === "active") updates.status = body.status
  if (body.metadata    !== undefined) updates.metadata    = body.metadata

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 })
  }

  const { data, error } = await admin
    .from("knowledge_sources")
    .update(updates)
    .eq("id", body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Fonte de conhecimento atualizada",
    detail:    `${existing.name} → ${JSON.stringify(Object.keys(updates))}`,
    companyId: existing.company_id,
  })

  return NextResponse.json(data)
}

// ─── DELETE — arquivar fonte ──────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as { id?: string }
  if (!body.id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("knowledge_sources")
    .select("company_id, name")
    .eq("id", body.id)
    .single()

  if (!existing) return NextResponse.json({ error: "Fonte não encontrada" }, { status: 404 })

  const [admin_, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!admin_ && !allowed.includes(existing.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  // Arquiva em vez de deletar (preserva histórico de mensagens que usaram a fonte)
  const { error } = await admin
    .from("knowledge_sources")
    .update({ status: "archived" })
    .eq("id", body.id)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Fonte de conhecimento arquivada",
    detail:    existing.name,
    companyId: existing.company_id,
  })

  return NextResponse.json({ ok: true })
}
