import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { logActivity } from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

// ─── GET — busca sessão ───────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { data, error } = await supabase
    .from("sessions")
    .select("*, agent:agents(short_name, color)")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error || !data) return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 })

  return NextResponse.json(data)
}

// ─── PATCH — atualiza título, pinned ou archived ──────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    title?:    string
    pinned?:   boolean
    archived?: boolean
  }

  const updates: Record<string, unknown> = {}
  if (typeof body.title    === "string")  updates.title    = body.title.slice(0, 200).trim()
  if (typeof body.pinned   === "boolean") updates.pinned   = body.pinned
  if (typeof body.archived === "boolean") updates.archived = body.archived

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("sessions")
    .update(updates)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id, title, pinned, archived")
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Sessão não encontrada" }, { status: 404 })
  }

  if (typeof body.title === "string") {
    void logActivity({
      userId: user.id, eventType: "chat", action: "Sessão renomeada",
      detail: body.title.slice(0, 80), metadata: { session_id: id }, sessionId: id,
    })
  }
  if (typeof body.pinned === "boolean") {
    void logActivity({
      userId: user.id, eventType: "chat",
      action: body.pinned ? "Sessão marcada como favorita" : "Sessão removida dos favoritos",
      metadata: { session_id: id }, sessionId: id,
    })
  }
  if (typeof body.archived === "boolean") {
    void logActivity({
      userId: user.id, eventType: "chat",
      action: body.archived ? "Sessão arquivada" : "Sessão desarquivada",
      metadata: { session_id: id }, sessionId: id,
    })
  }

  return NextResponse.json(data)
}

// ─── DELETE — soft delete ─────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { error } = await supabase
    .from("sessions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId: user.id, eventType: "chat", action: "Sessão excluída",
    metadata: { session_id: id }, sessionId: id,
  })

  return NextResponse.json({ ok: true })
}
