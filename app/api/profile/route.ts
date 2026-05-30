import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { logActivity }       from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

const VALID_COMPANY_SLUGS = ["cppem", "unicive", "colegio", "everton", "grupo"] as const

// ─── GET — perfil do usuário autenticado ──────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, email, name, role, job_title, default_company_id, avatar_url, updated_at")
    .eq("id", user.id)
    .single()

  // Safety net: profile deveria existir (criado pelo trigger on_auth_user_created)
  if (error || !profile) {
    const { data: created, error: createErr } = await admin
      .from("profiles")
      .insert({
        id:    user.id,
        email: user.email ?? "",
        name:  user.email?.split("@")[0] ?? "Usuário",
      })
      .select("id, email, name, role, job_title, default_company_id, avatar_url, updated_at")
      .single()

    if (createErr || !created) {
      return NextResponse.json({ error: "Erro ao carregar perfil" }, { status: 500 })
    }

    return NextResponse.json(created)
  }

  return NextResponse.json(profile)
}

// ─── PATCH — atualiza perfil do usuário autenticado ───────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    name?:               string
    job_title?:          string
    default_company_id?: string
  }

  if (
    body.default_company_id &&
    !(VALID_COMPANY_SLUGS as readonly string[]).includes(body.default_company_id)
  ) {
    return NextResponse.json({ error: "default_company_id inválido" }, { status: 400 })
  }

  const updates: Record<string, string> = {}
  if (typeof body.name      === "string") updates.name      = body.name.trim()
  if (typeof body.job_title === "string") updates.job_title = body.job_title.trim()
  if (body.default_company_id)            updates.default_company_id = body.default_company_id

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data, error } = await admin
    .from("profiles")
    .update(updates)
    .eq("id", user.id)
    .select("id, name, role, job_title, default_company_id, updated_at")
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Perfil atualizado",
    detail:    Object.keys(updates).join(", "),
    metadata:  { fields: Object.keys(updates) },
  })

  return NextResponse.json({ ok: true, ...data })
}
