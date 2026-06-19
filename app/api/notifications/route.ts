import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

// Lista as notificações in-app do usuário + contagem de não lidas.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ items: [], unread: 0 })

  const admin = createAdminClient()
  const [{ data: items }, { count: unread }] = await Promise.all([
    admin.from("notifications")
      .select("id, title, body, kind, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
    admin.from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null),
  ])

  return NextResponse.json({ items: items ?? [], unread: unread ?? 0 })
}

// Marca como lida: { id } para uma específica, ou sem body para todas.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { id?: string }
  const admin = createAdminClient()

  let q = admin.from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null)
  if (body.id) q = q.eq("id", body.id)
  await q

  return NextResponse.json({ ok: true })
}
