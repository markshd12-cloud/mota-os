import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin }     from "@/lib/company-scope"
import { logActivity }       from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

// ─── GET — detalhe do usuário ─────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const isAdmin = await isGlobalAdmin(user.id)
  if (!isAdmin && user.id !== id) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, name, email, role, job_title, department, default_company_id, avatar_url, created_at, updated_at")
    .eq("id", id)
    .single()

  if (error || !profile) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })

  const { data: members } = await admin
    .from("company_members")
    .select("company_id, role, status")
    .eq("user_id", id)

  return NextResponse.json({
    user: {
      ...profile,
      companies:     (members ?? []).filter((m) => m.status === "active").map((m) => m.company_id),
      company_roles: Object.fromEntries(
        (members ?? []).filter((m) => m.status === "active").map((m) => [m.company_id, m.role]),
      ),
    },
  })
}

// ─── PATCH — editar perfil ────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const isAdmin = await isGlobalAdmin(user.id)

  // Campos que apenas admin pode alterar
  const body = await req.json() as {
    name?:               string
    job_title?:          string
    department?:         string
    role?:               string
    default_company_id?: string
    avatar_url?:         string
  }

  // Não-admin só pode editar o próprio perfil e apenas campos básicos
  if (!isAdmin && user.id !== id) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name               !== undefined) patch.name               = body.name?.trim() || null
  if (body.job_title          !== undefined) patch.job_title          = body.job_title?.trim()  ?? ""
  if (body.department         !== undefined) patch.department         = body.department?.trim() ?? ""
  if (body.avatar_url         !== undefined) patch.avatar_url         = body.avatar_url  ?? null
  if (body.default_company_id !== undefined) patch.default_company_id = body.default_company_id ?? null

  // Apenas admin pode alterar role global
  if (isAdmin && body.role !== undefined) {
    patch.role = body.role
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", id)
    .select("id, name, email, role, job_title, department, default_company_id, avatar_url, updated_at")
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "user_profile_updated",
    detail:    data.name as string || (data.email as string),
    metadata:  { target_user_id: id, fields: Object.keys(patch).filter((k) => k !== "updated_at") },
  })

  return NextResponse.json({ user: data })
}
