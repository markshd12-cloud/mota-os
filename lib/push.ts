/**
 * Envio de Web Push (VAPID) para os dispositivos inscritos de um usuário.
 * SERVER-SIDE ONLY.
 */

import webpush from "web-push"
import type { SupabaseClient } from "@supabase/supabase-js"

let configured = false

function ensureVapid(): boolean {
  if (configured) return true
  const publicKey  = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject    = process.env.VAPID_SUBJECT || "mailto:administrador@cppem.com.br"
  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID keys ausentes — push desabilitado.")
    return false
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
  return true
}

export interface PushPayload {
  title: string
  body:  string
  url?:  string
  tag?:  string
}

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string }

/**
 * Envia um push para todos os dispositivos do usuário. Remove inscrições mortas
 * (404/410). Nunca lança — retorna quantos envios deram certo.
 */
export async function sendPushToUser(
  admin:  SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<number> {
  if (!ensureVapid()) return 0

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)

  if (!subs || subs.length === 0) return 0

  let sent = 0
  for (const s of subs as SubRow[]) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      )
      sent++
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode
      if (code === 404 || code === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id)
      }
    }
  }
  return sent
}
