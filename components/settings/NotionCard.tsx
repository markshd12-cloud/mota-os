"use client"

import { useEffect, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useCompany } from "@/components/providers/CompanyProvider"
import { Loader2, CheckCircle2, XCircle, ExternalLink, RefreshCw } from "lucide-react"

interface NotionStatus {
  connected:      boolean
  workspace_name: string | null
  workspace_icon: string | null
  connected_at:   string | null
}

function NotionIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.047.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933z" />
    </svg>
  )
}

export function NotionCard() {
  const { currentCompany } = useCompany()
  const companyId          = currentCompany?.slug
  const searchParams       = useSearchParams()
  const router             = useRouter()

  const [status, setStatus]           = useState<NotionStatus | null>(null)
  const [loading, setLoading]         = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [syncing, setSyncing]         = useState(false)
  const [feedback, setFeedback]       = useState<{ type: "success" | "error"; msg: string } | null>(null)

  // Captura parâmetros de retorno do callback
  useEffect(() => {
    const connected = searchParams.get("notion_connected")
    const error     = searchParams.get("notion_error")

    if (connected === "1") {
      setFeedback({ type: "success", msg: "Notion conectado com sucesso!" })
      const url = new URL(window.location.href)
      url.searchParams.delete("notion_connected")
      router.replace(url.pathname + url.search)
    } else if (error) {
      const msgs: Record<string, string> = {
        invalid_state:        "Erro de segurança (state inválido). Tente novamente.",
        token_exchange_failed:"Falha ao trocar o código pelo token. Tente novamente.",
        server_error:         "Erro interno. Tente novamente.",
        access_denied:        "Autorização negada pelo Notion.",
      }
      setFeedback({ type: "error", msg: msgs[error] ?? `Erro: ${error}` })
      const url = new URL(window.location.href)
      url.searchParams.delete("notion_error")
      router.replace(url.pathname + url.search)
    }
  }, [searchParams, router])

  useEffect(() => {
    if (!companyId) return
    void loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function loadStatus() {
    setLoading(true)
    try {
      const res = await fetch(`/api/notion/status?company_id=${encodeURIComponent(companyId!)}`)
      if (res.ok) setStatus(await res.json() as NotionStatus)
      else setStatus({ connected: false, workspace_name: null, workspace_icon: null, connected_at: null })
    } catch {
      setStatus({ connected: false, workspace_name: null, workspace_icon: null, connected_at: null })
    }
    setLoading(false)
  }

  async function handleSync() {
    if (!companyId) return
    setSyncing(true)
    setFeedback(null)
    try {
      const res = await fetch("/api/notion/sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ company_id: companyId }),
      })
      const data = await res.json() as { ok?: boolean; total?: number; updated?: number; skipped?: number; failed?: number; message?: string; error?: string }
      if (res.ok && data.ok) {
        setFeedback({
          type: "success",
          msg: data.total === 0
            ? "Nenhuma fonte do Notion para sincronizar. Importe páginas pelo chat primeiro."
            : `Sincronizado: ${data.updated} atualizada(s), ${data.skipped} sem mudança${data.failed ? `, ${data.failed} falha(s)` : ""}.`,
        })
      } else {
        setFeedback({ type: "error", msg: data.error ?? "Erro ao sincronizar." })
      }
    } catch {
      setFeedback({ type: "error", msg: "Erro de conexão ao sincronizar." })
    }
    setSyncing(false)
  }

  async function handleDisconnect() {
    if (!companyId) return
    setDisconnecting(true)
    const res = await fetch("/api/auth/notion/disconnect", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ company_id: companyId }),
    })
    if (res.ok) {
      setStatus({ connected: false, workspace_name: null, workspace_icon: null, connected_at: null })
      setFeedback({ type: "success", msg: "Notion desconectado." })
    } else {
      setFeedback({ type: "error", msg: "Erro ao desconectar." })
    }
    setDisconnecting(false)
  }

  const connectUrl = companyId
    ? `/api/auth/notion/connect?company_id=${encodeURIComponent(companyId)}`
    : "#"

  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ borderColor: "var(--border-color)", background: "var(--bg-card)" }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--border-color)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.06)" }}>
            <NotionIcon size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Notion</p>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Contexto de páginas no chat</p>
          </div>
        </div>

        {loading ? (
          <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        ) : status?.connected ? (
          <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full"
            style={{ background: "rgba(22,163,74,0.1)", color: "#16a34a" }}>
            <CheckCircle2 size={11} /> Conectado
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full"
            style={{ background: "var(--bg-hover)", color: "var(--text-muted)" }}>
            <XCircle size={11} /> Desconectado
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {feedback && (
          <div className="flex items-start gap-2 text-[11px] p-2.5 rounded-xl"
            style={{
              background: feedback.type === "success" ? "rgba(22,163,74,0.06)" : "rgba(239,68,68,0.06)",
              color:      feedback.type === "success" ? "#16a34a" : "#ef4444",
            }}>
            {feedback.msg}
          </div>
        )}

        {!loading && status?.connected ? (
          <div className="space-y-1">
            {status.workspace_name && (
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Workspace: <span className="font-medium" style={{ color: "var(--text-primary)" }}>
                  {status.workspace_name}
                </span>
              </p>
            )}
            {status.connected_at && (
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                Conectado em {new Date(status.connected_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
              </p>
            )}
          </div>
        ) : !loading ? (
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Conecte o workspace do Notion para acessar suas páginas diretamente no chat.
          </p>
        ) : null}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t"
        style={{ borderColor: "var(--border-color)" }}>
        {status?.connected && (
          <button onClick={() => void handleDisconnect()} disabled={disconnecting}
            className="text-[11px] px-3 py-1.5 rounded-lg border transition-colors hover:bg-red-50 disabled:opacity-50"
            style={{ borderColor: "rgba(239,68,68,0.3)", color: "#ef4444" }}>
            {disconnecting ? "Desconectando..." : "Desconectar"}
          </button>
        )}
        <div className="flex-1" />
        {status?.connected && (
          <button onClick={() => void handleSync()} disabled={syncing}
            className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50 mr-2"
            style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
            title="Re-extrai e re-indexa as fontes do Notion para a busca automática">
            <RefreshCw size={11} className={syncing ? "animate-spin" : undefined} />
            {syncing ? "Sincronizando..." : "Sincronizar fontes"}
          </button>
        )}
        {status?.connected ? (
          <a href={connectUrl}
            className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)]"
            style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
            <ExternalLink size={11} /> Reconectar
          </a>
        ) : (
          <a href={connectUrl}
            className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg font-medium transition-colors text-white"
            style={{ background: "var(--text-primary)" }}>
            <NotionIcon size={11} /> Conectar Notion
          </a>
        )}
      </div>
    </div>
  )
}
