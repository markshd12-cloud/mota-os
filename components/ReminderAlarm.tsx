"use client"

/**
 * Alarme de lembretes — modal central bloqueante + som, como um despertador.
 * Faz polling em /api/notifications; quando chega um lembrete novo (não lido,
 * recente), abre um overlay no centro da tela e toca um alarme em loop até o
 * usuário clicar em "OK". Montado globalmente no AppShell.
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { BellRing } from "lucide-react"
import { ensurePushSubscribed } from "@/lib/push-client"

type Notif = {
  id: string; title: string; body: string; kind: string
  read_at: string | null; created_at: string
}

const POLL_MS     = 12_000          // verifica a cada 12s
const LOOKBACK_MS = 5 * 60_000      // só alarma lembretes criados nos últimos 5 min

export function ReminderAlarm() {
  const [current, setCurrent] = useState<Notif | null>(null)
  const currentRef  = useRef<Notif | null>(null)
  const queueRef    = useRef<Notif[]>([])
  const alarmedRef  = useRef<Set<string>>(new Set())
  const audioRef    = useRef<AudioContext | null>(null)
  const beatRef     = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { currentRef.current = current }, [current])

  // Mantém a inscrição de Web Push viva (só age se a permissão já foi concedida)
  useEffect(() => { void ensurePushSubscribed() }, [])

  // Desbloqueia o áudio no primeiro gesto (política de autoplay dos navegadores)
  useEffect(() => {
    function unlock() {
      if (!audioRef.current) {
        const Ctx = window.AudioContext
          ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (Ctx) { try { audioRef.current = new Ctx() } catch { /* sem áudio */ } }
      }
      audioRef.current?.resume?.().catch(() => {})
    }
    window.addEventListener("pointerdown", unlock)
    window.addEventListener("keydown", unlock)
    return () => {
      window.removeEventListener("pointerdown", unlock)
      window.removeEventListener("keydown", unlock)
    }
  }, [])

  const beep = useCallback(() => {
    const ctx = audioRef.current
    if (!ctx) return
    if (ctx.state === "suspended") ctx.resume().catch(() => {})
    const now = ctx.currentTime
    const freqs = [880, 1175, 880, 1175]  // "tiririri"
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "square"
      osc.frequency.value = f
      const t = now + i * 0.12
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.10)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.start(t); osc.stop(t + 0.11)
    })
  }, [])

  const startAlarm = useCallback(() => {
    beep()
    beatRef.current = setInterval(beep, 900)
  }, [beep])

  const stopAlarm = useCallback(() => {
    if (beatRef.current) { clearInterval(beatRef.current); beatRef.current = null }
  }, [])

  // Polling: preenche a fila e promove o próximo se nada estiver sendo exibido
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch("/api/notifications")
        if (!res.ok) return
        const data = await res.json() as { items?: Notif[] }
        const fresh = (data.items ?? []).filter(n =>
          n.kind === "reminder" && !n.read_at && !alarmedRef.current.has(n.id) &&
          Date.now() - new Date(n.created_at).getTime() < LOOKBACK_MS,
        )
        for (const n of fresh.reverse()) {  // mais antigos primeiro
          alarmedRef.current.add(n.id)
          queueRef.current.push(n)
        }
        if (!currentRef.current && queueRef.current.length > 0) {
          setCurrent(queueRef.current.shift() ?? null)
        }
      } catch { /* silencioso */ }
    }
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => clearInterval(t)
  }, [])

  // Liga/desliga o som conforme o modal abre/fecha
  useEffect(() => {
    if (current) startAlarm()
    else stopAlarm()
    return () => stopAlarm()
  }, [current, startAlarm, stopAlarm])

  const dismiss = useCallback(() => {
    const n = currentRef.current
    stopAlarm()
    setCurrent(null)
    if (n) {
      fetch("/api/notifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      }).then(() => window.dispatchEvent(new Event("notifications-read"))).catch(() => {})
    }
    setTimeout(() => {
      if (queueRef.current.length > 0) setCurrent(queueRef.current.shift() ?? null)
    }, 400)
  }, [stopAlarm])

  if (!current) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
    >
      <div
        className="w-[90%] max-w-md rounded-2xl border p-6 text-center shadow-2xl"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        <div
          className="mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center animate-bounce"
          style={{ background: "var(--bg-active)" }}
        >
          <BellRing size={30} className="text-mota-600" />
        </div>
        <h2 className="text-lg font-bold mb-2" style={{ color: "var(--text-primary)" }}>
          ⏰ Lembrete
        </h2>
        <p className="text-sm whitespace-pre-wrap mb-6" style={{ color: "var(--text-secondary)" }}>
          {current.body}
        </p>
        <button
          onClick={dismiss}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-mota-600 hover:bg-mota-700 transition-colors"
        >
          OK, entendi
        </button>
      </div>
    </div>
  )
}
