/**
 * Web Push no lado do cliente: registra o service worker, pede permissão e
 * envia a PushSubscription para o servidor. BROWSER ONLY.
 */

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(normalized)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export type PushState = "unsupported" | "default" | "granted" | "denied"

export function pushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
}

export function pushPermission(): PushState {
  if (!pushSupported()) return "unsupported"
  return Notification.permission as PushState
}

export async function subscribeToPush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: "Navegador não suporta notificações." }
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!key) return { ok: false, error: "VAPID não configurado." }

  try {
    const reg = await navigator.serviceWorker.register("/sw.js")
    await navigator.serviceWorker.ready

    const perm = await Notification.requestPermission()
    if (perm !== "granted") return { ok: false, error: "Permissão negada." }

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      })
    }

    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    })
    if (!res.ok) return { ok: false, error: "Falha ao registrar no servidor." }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao ativar." }
  }
}

/** Mantém a inscrição viva sem pedir permissão de novo (só se já foi concedida). */
export async function ensurePushSubscribed(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return
  await subscribeToPush().catch(() => {})
}
