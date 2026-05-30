import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import {
  getAllowedCompanyIds,
  getCurrentCompany,
  isParentCompany,
  ALL_SLUGS,
  getUserRole,
} from "@/lib/company-scope"
import { logActivity } from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

// ─── GET — empresa ativa, lista permitida e role do usuário ───────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  const [currentSlug, allowedSlugs, userRole] = await Promise.all([
    getCurrentCompany(user.id),
    getAllowedCompanyIds(user.id),
    getUserRole(user.id),
  ])

  const { data: companies } = await admin
    .from("companies")
    .select("slug, name, color, initials, description, active")
    .in("slug", allowedSlugs.length > 0 ? allowedSlugs : ALL_SLUGS)
    .eq("active", true)

  const companyMap = new Map((companies ?? []).map(c => [c.slug, c]))

  const allowed = allowedSlugs
    .map(s => companyMap.get(s))
    .filter(Boolean) as typeof companies

  const current = companyMap.get(currentSlug) ?? null

  return NextResponse.json({
    company: current,
    allowed: allowed ?? [],
    role:    userRole,
  })
}

// ─── PATCH — atualizar empresa ativa ─────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { company_id } = await req.json() as { company_id?: string }

  if (!company_id || !(ALL_SLUGS as string[]).includes(company_id)) {
    return NextResponse.json({ error: "company_id inválido" }, { status: 400 })
  }

  const userRole = await getUserRole(user.id)
  const isAdmin  = userRole === "admin"

  // Grupo Mota apenas para admin
  if (isParentCompany(company_id) && !isAdmin) {
    return NextResponse.json(
      { error: "Grupo Mota é uma visão administrativa e não está disponível para seu perfil." },
      { status: 403 }
    )
  }

  const allowed = await getAllowedCompanyIds(user.id)
  if (!allowed.includes(company_id as typeof ALL_SLUGS[number])) {
    return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from("profiles")
    .update({ default_company_id: company_id })
    .eq("id", user.id)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Empresa ativa alterada",
    detail:    company_id,
    companyId: company_id,
  })

  return NextResponse.json({ ok: true, company_id })
}
