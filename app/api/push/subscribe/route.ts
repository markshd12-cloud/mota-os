import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

// Salva (upsert) a PushSubscription do navegador do usuário.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json().catch(() => null) as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  } | null

  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "Inscrição inválida" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from("push_subscriptions")
    .upsert({
      user_id:    user.id,
      endpoint:   body.endpoint,
      p256dh:     body.keys.p256dh,
      auth:       body.keys.auth,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    }, { onConflict: "endpoint" })

  if (error) return NextResponse.json({ error: "Erro ao salvar inscrição" }, { status: 500 })
  return NextResponse.json({ ok: true })
}
