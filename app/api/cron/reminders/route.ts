import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-admin"
import { sendRocketChatMessage } from "@/lib/watchers/notify"
import { computeNextRunAt, type Recurrence } from "@/lib/reminders"
import { sendPushToUser } from "@/lib/push"
import { logActivity } from "@/lib/activity-logger"

export const dynamic = "force-dynamic"
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"
    return !isProd // em dev sem secret, libera para testes
  }
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true
  return new URL(req.url).searchParams.get("secret") === secret
}

type ReminderRow = {
  id: string; user_id: string; company_id: string | null; content: string
  time_of_day: string; timezone: string; recurrence: Recurrence
  days_of_week: number[] | null; channels: string[]
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  const { data: due, error } = await admin
    .from("reminders")
    .select("id, user_id, company_id, content, time_of_day, timezone, recurrence, days_of_week, channels")
    .eq("active", true)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: "Erro ao listar lembretes" }, { status: 500 })
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, fired: 0, ran_at: nowIso })
  }

  let fired = 0, notified = 0, rocketSent = 0, pushed = 0
  const now = new Date()

  for (const r of due as ReminderRow[]) {
    const channels = Array.isArray(r.channels) ? r.channels : ["inapp", "rocketchat"]
    const text = `⏰ Lembrete: ${r.content}`

    // ── Entrega in-app (notificação no sininho + Web Push do navegador) ──
    if (channels.includes("inapp")) {
      const { error: nErr } = await admin.from("notifications").insert({
        user_id: r.user_id, title: "Lembrete", body: r.content, kind: "reminder",
      })
      if (!nErr) notified++
      pushed += await sendPushToUser(admin, r.user_id, {
        title: "⏰ Lembrete", body: r.content, url: "/notifications", tag: `reminder-${r.id}`,
      })
    }

    // ── Entrega Rocket.Chat ──
    if (channels.includes("rocketchat")) {
      const res = await sendRocketChatMessage(admin, r.company_id, text)
      if (res.sent) rocketSent++
    }

    // ── Reagenda (ou desativa se 'once') ──
    const next = r.recurrence === "once"
      ? null
      : computeNextRunAt(
          { time_of_day: r.time_of_day, recurrence: r.recurrence, days_of_week: r.days_of_week, timezone: r.timezone || "America/Recife" },
          now,
        )

    await admin.from("reminders").update({
      last_run_at: nowIso,
      next_run_at: next ? next.toISOString() : nowIso,
      active:      next !== null,   // 'once' (ou cálculo nulo) → desativa
    }).eq("id", r.id)

    fired++
    void logActivity({
      userId: r.user_id, eventType: "auto", action: "reminder_fired",
      detail: r.content.slice(0, 120), companyId: r.company_id ?? undefined,
      metadata: { reminder_id: r.id, recurrence: r.recurrence },
    })
  }

  return NextResponse.json({ ok: true, fired, notified, pushed, rocket_sent: rocketSent, ran_at: nowIso })
}

export async function GET(req: NextRequest)  { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
