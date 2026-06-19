"use client"

import { useEffect, useState } from "react"
import { Bell, Clock } from "lucide-react"

type Notif = {
  id: string; title: string; body: string; kind: string
  read_at: string | null; created_at: string
}

export default function NotificationsPage() {
  const [items, setItems]     = useState<Notif[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/notifications")
      .then(r => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: Notif[] }) => setItems(d.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))

    // Marca todas como lidas e avisa a sidebar para zerar o badge
    fetch("/api/notifications", { method: "POST" })
      .then(() => window.dispatchEvent(new Event("notifications-read")))
      .catch(() => {})
  }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header
        className="flex items-center gap-3 px-6 py-4 border-b shrink-0"
        style={{ borderColor: "var(--border-color)", background: "var(--bg-secondary)" }}
      >
        <Bell size={18} style={{ color: "var(--text-primary)" }} />
        <h1 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Avisos</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-2">
          {loading ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Carregando…</p>
          ) : items.length === 0 ? (
            <div className="text-center py-16">
              <Bell size={28} style={{ color: "var(--text-muted)" }} className="mx-auto mb-3" />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>Nenhum aviso por enquanto.</p>
              <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                Lembretes que você criar no chat aparecem aqui no horário marcado.
              </p>
            </div>
          ) : (
            items.map(n => (
              <div
                key={n.id}
                className="rounded-xl border p-4"
                style={{
                  background: n.read_at ? "var(--bg-card)" : "var(--bg-active)",
                  borderColor: "var(--border-color)",
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Clock size={13} style={{ color: "var(--mota-600, #16a34a)" }} />
                  <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                    {n.title || "Lembrete"}
                  </span>
                  <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>
                    {new Date(n.created_at).toLocaleString("pt-BR", { timeZone: "America/Recife" })}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                  {n.body}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
