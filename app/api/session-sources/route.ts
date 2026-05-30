import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { logActivity }       from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

// ─── GET — fontes vinculadas a uma sessão ─────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const sessionId = new URL(req.url).searchParams.get("session_id")
  if (!sessionId) return NextResponse.json({ error: "session_id obrigatório" }, { status: 400 })

  const admin = createAdminClient()

  // Verifica que a sessão pertence ao usuário
  const { data: session } = await admin
    .from("sessions")
    .select("id, user_id, company_id")
    .eq("id", sessionId)
    .single()

  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 })
  }

  const { data, error } = await admin
    .from("session_sources")
    .select(`
      id,
      source_id,
      created_at,
      knowledge_sources (
        id, name, description, type, status, company_id, content
      )
    `)
    .eq("session_id", sessionId)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  // Filtra apenas fontes da mesma empresa que a sessão (dupla segurança)
  const filtered = (data ?? []).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => r.knowledge_sources?.company_id === session.company_id
  )

  return NextResponse.json(filtered)
}

// ─── POST — vincular fonte à sessão ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as { session_id?: string; source_id?: string }
  const { session_id, source_id } = body

  if (!session_id || !source_id) {
    return NextResponse.json({ error: "session_id e source_id obrigatórios" }, { status: 400 })
  }

  const admin = createAdminClient()

  const [sessionRes, sourceRes] = await Promise.all([
    admin.from("sessions").select("id, user_id, company_id").eq("id", session_id).single(),
    admin.from("knowledge_sources").select("id, company_id, status").eq("id", source_id).single(),
  ])

  if (!sessionRes.data || sessionRes.data.user_id !== user.id) {
    return NextResponse.json({ error: "Sessão não encontrada ou sem acesso" }, { status: 404 })
  }
  if (!sourceRes.data || sourceRes.data.status === "archived") {
    return NextResponse.json({ error: "Fonte não encontrada ou arquivada" }, { status: 404 })
  }
  if (sessionRes.data.company_id !== sourceRes.data.company_id) {
    return NextResponse.json({
      error: `Fonte pertence à empresa "${sourceRes.data.company_id}", sessão pertence à "${sessionRes.data.company_id}"`,
    }, { status: 422 })
  }

  const { data, error } = await admin
    .from("session_sources")
    .upsert({ session_id, source_id }, { onConflict: "session_id,source_id" })
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "chat",
    action:    "Fonte vinculada à sessão",
    detail:    `source=${source_id}`,
    sessionId: session_id,
    companyId: sessionRes.data.company_id,
  })

  return NextResponse.json(data, { status: 201 })
}

// ─── DELETE — desvincular fonte da sessão ────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as { session_id?: string; source_id?: string }
  const { session_id, source_id } = body

  if (!session_id || !source_id) {
    return NextResponse.json({ error: "session_id e source_id obrigatórios" }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: session } = await admin
    .from("sessions")
    .select("user_id, company_id")
    .eq("id", session_id)
    .single()

  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 })
  }

  const { error } = await admin
    .from("session_sources")
    .delete()
    .eq("session_id", session_id)
    .eq("source_id", source_id)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "chat",
    action:    "Fonte removida da sessão",
    detail:    `source=${source_id}`,
    sessionId: session_id,
    companyId: session.company_id,
  })

  return NextResponse.json({ ok: true })
}
