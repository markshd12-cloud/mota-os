import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { logActivity }       from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

// ─── GET — listar sessões ativas do usuário ───────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const fingerprint = searchParams.get("fingerprint")

  const admin = createAdminClient()

  const { data, error } = await admin
    .from("user_sessions")
    .select("id, ip_address, user_agent, device_name, location, last_seen_at, created_at, revoked_at, metadata")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(10)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json({
    sessions: (data ?? []).map((s) => ({
      ...s,
      is_current: fingerprint
        ? (s.metadata as Record<string, string>)?.device_fingerprint === fingerprint
        : false,
    })),
  })
}

// ─── DELETE — revogar sessão por id ──────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { id } = await req.json() as { id?: string }
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 })

  const admin = createAdminClient()

  // Verificar que a sessão pertence ao usuário e ainda está ativa
  const { data: sess } = await admin
    .from("user_sessions")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle()

  if (!sess) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 })

  await admin
    .from("user_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)

  void logActivity({
    userId:    user.id,
    eventType: "auth",
    action:    "security_session_revoked",
    detail:    `Sessão revogada: ${id}`,
    metadata:  { session_id: id },
  })

  return NextResponse.json({
    ok:   true,
    note: "Sessão marcada como revogada no Jarvis. A revogação completa do token depende da expiração natural no Supabase Auth.",
  })
}
