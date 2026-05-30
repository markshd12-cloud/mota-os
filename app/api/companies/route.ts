import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { logActivity }       from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

// ─── GET — lista todas as empresas ───────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  const { data, error } = await admin
    .from("companies")
    .select("id, slug, name, description, color, initials, active, logo_url, updated_at")
    .order("name")

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json(data ?? [])
}

// ─── PATCH — atualiza uma empresa (admin only) ────────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  // Verificar se usuário é admin
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "admin") {
    return NextResponse.json(
      { error: "Permissão administrativa necessária." },
      { status: 403 },
    )
  }

  const body = await req.json() as {
    id:           string
    name?:        string
    description?: string
    color?:       string
    active?:      boolean
  }

  if (!body.id?.trim()) {
    return NextResponse.json({ error: "id obrigatório" }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.name        === "string")  updates.name        = body.name.trim()
  if (typeof body.description === "string")  updates.description = body.description
  if (typeof body.color       === "string")  updates.color       = body.color.trim()
  if (typeof body.active      === "boolean") updates.active      = body.active

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 })
  }

  const { data, error } = await admin
    .from("companies")
    .update(updates)
    .eq("id", body.id)
    .select("id, slug, name, description, color, initials, active, updated_at")
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Empresa atualizada",
    detail:    data.name,
    metadata:  { company_id: data.id, slug: data.slug, fields: Object.keys(updates) },
  })

  return NextResponse.json({ ok: true, ...data })
}
