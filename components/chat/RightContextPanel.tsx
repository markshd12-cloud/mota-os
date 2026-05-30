"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  X, Bot, Database, Loader2,
  BookOpen, HelpCircle, FileText, Package,
  AlertTriangle, File, Link as LinkIcon,
} from "lucide-react"
import type { Agent } from "@/lib/mocks/agents"

interface SessionSource {
  id:        string
  source_id: string
  knowledge_sources: {
    id:          string
    name:        string
    type:        string
    description: string | null
    status:      string
  } | null
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  playbook:         BookOpen,
  faq:              HelpCircle,
  script:           FileText,
  product_info:     Package,
  brand_voice:      FileText,
  offer:            Package,
  objection:        AlertTriangle,
  competitor:       AlertTriangle,
  internal_process: File,
  document:         File,
  link:             LinkIcon,
  manual_note:      FileText,
}

const TYPE_LABELS: Record<string, string> = {
  playbook:         "Playbook",
  faq:              "FAQ",
  script:           "Script",
  product_info:     "Produto",
  brand_voice:      "Tom de voz",
  offer:            "Oferta",
  objection:        "Objeção",
  competitor:       "Concorrente",
  internal_process: "Processo",
  document:         "Documento",
  link:             "Link",
  manual_note:      "Nota",
}

interface RightContextPanelProps {
  open:           boolean
  onClose:        () => void
  agent:          Agent | null
  sessionTitle:   string
  sessionId?:     string | null
  companyId?:     string
  sourcesVersion?: number
}

export function RightContextPanel({
  open, onClose, agent, sessionTitle, sessionId, companyId, sourcesVersion,
}: RightContextPanelProps) {
  const [sessionSources, setSessionSources] = useState<SessionSource[]>([])
  const [loadingSources, setLoadingSources] = useState(false)

  const loadSources = useCallback(async () => {
    if (!sessionId) { setSessionSources([]); return }
    setLoadingSources(true)
    try {
      const res = await fetch(`/api/session-sources?session_id=${encodeURIComponent(sessionId)}`)
      if (res.ok) setSessionSources(await res.json() as SessionSource[])
    } finally {
      setLoadingSources(false)
    }
  }, [sessionId])

  useEffect(() => { void loadSources() }, [loadSources, sourcesVersion])

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 300, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: "easeInOut" }}
          className="flex flex-col h-full border-l overflow-hidden shrink-0"
          style={{ borderColor: "var(--border-color)", background: "var(--bg-sidebar)" }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 h-14 border-b shrink-0"
            style={{ borderColor: "var(--border-color)" }}
          >
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Contexto
            </span>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Active agent */}
            <Section icon={Bot} label="Agente ativo">
              {!agent ? (
                <p className="text-xs px-3 py-2" style={{ color: "var(--text-muted)" }}>
                  Jarvis padrão — nenhum agente selecionado
                </p>
              ) : (
              <div className="space-y-2">
                <div
                  className="flex items-center gap-3 p-3 rounded-xl border"
                  style={{ borderColor: `${agent.color}30`, background: agent.bg }}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${agent.color}20` }}
                  >
                    <agent.icon size={16} style={{ color: agent.color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {agent.name}
                    </p>
                    <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      {agent.description}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {agent.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: `${agent.color}15`, color: agent.color }}
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
              )}
            </Section>

            {/* Active sources */}
            <Section
              icon={Database}
              label={`Fontes ativas${sessionSources.length > 0 ? ` (${sessionSources.length})` : ""}`}
            >
              {loadingSources ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                </div>
              ) : !sessionId ? (
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Inicie uma conversa para vincular fontes de conhecimento.
                </p>
              ) : sessionSources.length === 0 ? (
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  Nenhuma fonte selecionada. Use o ícone{" "}
                  <span className="inline-flex items-center gap-0.5 font-medium" style={{ color: "var(--text-secondary)" }}>
                    <Database size={10} /> banco de dados
                  </span>{" "}
                  no chat para adicionar.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {sessionSources.map((r) => {
                    const src = r.knowledge_sources
                    if (!src) return null
                    const Icon  = TYPE_ICONS[src.type] ?? FileText
                    const label = TYPE_LABELS[src.type] ?? src.type
                    return (
                      <div
                        key={r.id}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg border"
                        style={{ borderColor: "var(--border-color)", background: "var(--bg-card)" }}
                      >
                        <Icon size={12} className="text-mota-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                            {src.name}
                          </p>
                          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                            {label}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Section>

            {/* Session info */}
            {sessionId && (
              <Section icon={Bot} label="Sessão">
                <div
                  className="rounded-xl border p-3 space-y-2"
                  style={{ borderColor: "var(--border-color)", background: "var(--bg-card)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>Título</span>
                    <span
                      className="text-[11px] font-medium text-right"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {sessionTitle}
                    </span>
                  </div>
                  {companyId && (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Empresa</span>
                      <span className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>
                        {companyId}
                      </span>
                    </div>
                  )}
                </div>
              </Section>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function Section({ icon: Icon, label, children }: {
  icon: React.ElementType
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border-color)" }}>
      <div className="flex items-center gap-1.5 mb-3">
        <Icon size={12} className="text-mota-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
      </div>
      {children}
    </div>
  )
}
