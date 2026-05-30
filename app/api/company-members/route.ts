import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds, ALL_SLUGS } from "@/lib/company-scope"
import { logActivity } from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

// ─── GET — lista membros de uma empresa ──────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const companyId = new URL(req.url).searchParams.get("company_id")
  if (!companyId || !(ALL_SLUGS as string[]).includes(companyId)) {
    return NextResponse.json({ error: "company_id obrigatório e válido" }, { status: 400 })
  }

  // Verifica acesso
  const [admin_, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!admin_ && !allowed.includes(companyId as typeof ALL_SLUGS[number])) {
    return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: members, error } = await admin
    .from("company_members")
    .select("id, company_id, user_id, role, status, created_at")
    .eq("company_id", companyId)
    .order("created_at")

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  // Enriquecer com dados do perfil
  const userIds = (members ?? []).map(m => m.user_id).filter(Boolean)
  const { data: profiles } = userIds.length > 0
    ? await admin.from("profiles").select("id, name, email").in("id", userIds)
    : { data: [] }

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]))

  const enriched = (members ?? []).map(m => ({
    ...m,
    user_name:  profileMap.get(m.user_id)?.name  ?? "",
    user_email: profileMap.get(m.user_id)?.email ?? "",
  }))

  return NextResponse.json(enriched)
}

// ─── POST — adicionar membro a empresa (admin) ────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  if (!(await isGlobalAdmin(user.id))) {
    return NextResponse.json({ error: "Apenas administradores podem adicionar membros" }, { status: 403 })
  }

  const body = await req.json() as {
    company_id?: string
    user_id?:    string
    role?:       string
  }

  const { company_id, user_id, role = "member" } = body
  if (!company_id || !(ALL_SLUGS as string[]).includes(company_id)) {
    return NextResponse.json({ error: "company_id inválido" }, { status: 400 })
  }
  if (!user_id) return NextResponse.json({ error: "user_id obrigatório" }, { status: 400 })

  const VALID_ROLES = ["owner", "admin", "manager", "member", "viewer"]
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "role inválido" }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data, error } = await admin
    .from("company_members")
    .upsert({ company_id, user_id, role, status: "active" }, { onConflict: "company_id,user_id" })
    .select("id, company_id, user_id, role, status")
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Membro adicionado a empresa",
    detail:    `${user_id} → ${company_id} (${role})`,
    companyId: company_id,
  })

  return NextResponse.json(data)
}

// ─── PATCH — atualizar role ou status de membro (admin) ───────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  if (!(await isGlobalAdmin(user.id))) {
    return NextResponse.json({ error: "Apenas administradores podem editar membros" }, { status: 403 })
  }

  const body = await req.json() as {
    id?:         string
    company_id?: string
    user_id?:    string
    role?:       string
    status?:     string
  }

  if (!body.id && !(body.company_id && body.user_id)) {
    return NextResponse.json({ error: "id ou (company_id + user_id) obrigatórios" }, { status: 400 })
  }

  const updates: Record<string, string> = {}
  const VALID_ROLES   = ["owner", "admin", "manager", "member", "viewer"]
  const VALID_STATUSES = ["active", "inactive"]
  if (body.role   && VALID_ROLES.includes(body.role))     updates.role   = body.role
  if (body.status && VALID_STATUSES.includes(body.status)) updates.status = body.status

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 })
  }

  const admin = createAdminClient()

  let q = admin.from("company_members").update(updates)

  if (body.id) {
    q = q.eq("id", body.id)
  } else {
    q = q.eq("company_id", body.company_id!).eq("user_id", body.user_id!)
  }

  const { data, error } = await q.select("id, role, status").single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Membro de empresa atualizado",
    detail:    `${body.company_id ?? ""} — ${JSON.stringify(updates)}`,
    companyId: body.company_id,
  })

  return NextResponse.json(data)
}

// ─── DELETE — remover membro de empresa (admin) ───────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  if (!(await isGlobalAdmin(user.id))) {
    return NextResponse.json({ error: "Apenas administradores podem remover membros" }, { status: 403 })
  }

  const body = await req.json() as { company_id?: string; user_id?: string }

  if (!body.company_id || !body.user_id) {
    return NextResponse.json({ error: "company_id e user_id obrigatórios" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from("company_members")
    .delete()
    .eq("company_id", body.company_id)
    .eq("user_id", body.user_id)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Membro removido de empresa",
    detail:    `${body.user_id} → ${body.company_id}`,
    companyId: body.company_id,
  })

  return NextResponse.json({ ok: true })
}
