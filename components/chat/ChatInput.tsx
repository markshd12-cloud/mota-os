"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Paperclip, Database, Send, ChevronDown, Check, X, Loader2, FileText, Image,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { AgentSelector } from "./AgentSelector"
import type { Agent } from "@/lib/mocks/agents"
import type { SlashAgentPublic } from "@/lib/slash-agents"
import { AI_MODE_LIST, type AIMode } from "@/lib/ai/model-registry"

export type { Agent }

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface PendingAttachment {
  id:        string        // local temp ID
  file:      File
  uploading: boolean
  uploadedId?: string      // ID no banco após upload
  warning?:    string | null
  error?:      string | null
}

interface KnowledgeSource {
  id:          string
  name:        string
  type:        string
  description: string | null
}

interface ChatInputProps {
  selectedAgent?:    Agent | null
  onAgentChange:     (a: Agent) => void
  onSend:            (text: string, aiMode: AIMode, attachmentIds: string[]) => void
  agents?:           Agent[]
  disabled?:         boolean
  sessionId?:        string | null
  companyId?:        string
  onSourcesChanged?: () => void
}

// ─── Sources popup ────────────────────────────────────────────────────────────

function SourcesPopup({ sessionId, companyId, onSourcesChanged }: {
  sessionId?: string | null
  companyId?: string
  onSourcesChanged?: () => void
}) {
  const [sources, setSources]   = useState<KnowledgeSource[]>([])
  const [linked, setLinked]     = useState<Set<string>>(new Set())
  const [loading, setLoading]   = useState(true)
  const [toggling, setToggling] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true)
    const [srcRes, lnkRes] = await Promise.all([
      fetch(`/api/knowledge-sources?company_id=${encodeURIComponent(companyId)}`),
      sessionId
        ? fetch(`/api/session-sources?session_id=${encodeURIComponent(sessionId)}`)
        : Promise.resolve(null),
    ])
    if (srcRes.ok) setSources(await srcRes.json() as KnowledgeSource[])
    if (lnkRes?.ok) {
      const data = await lnkRes.json() as { source_id: string }[]
      setLinked(new Set(data.map((r) => r.source_id)))
    }
    setLoading(false)
  }, [companyId, sessionId])

  useEffect(() => { void load() }, [load])

  async function toggle(sourceId: string) {
    if (!sessionId) return
    setToggling((prev) => new Set([...prev, sourceId]))
    const isLinked = linked.has(sourceId)
    if (isLinked) {
      const res = await fetch("/api/session-sources", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, source_id: sourceId }),
      })
      if (res.ok) { setLinked((prev) => { const next = new Set(prev); next.delete(sourceId); return next }); onSourcesChanged?.() }
    } else {
      const res = await fetch("/api/session-sources", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, source_id: sourceId }),
      })
      if (res.ok) { setLinked((prev) => new Set([...prev, sourceId])); onSourcesChanged?.() }
    }
    setToggling((prev) => { const next = new Set(prev); next.delete(sourceId); return next })
  }

  if (!sessionId) return (
    <p className="text-xs px-3 py-3" style={{ color: "var(--text-muted)" }}>
      Envie uma mensagem primeiro para vincular fontes à sessão.
    </p>
  )
  if (loading) return (
    <div className="flex items-center justify-center py-5 gap-2">
      <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Carregando...</span>
    </div>
  )
  if (sources.length === 0) return (
    <p className="text-xs px-3 py-4 text-center" style={{ color: "var(--text-muted)" }}>
      Nenhuma fonte cadastrada para esta empresa.
    </p>
  )

  return (
    <div className="max-h-64 overflow-y-auto p-1">
      {sources.map((s) => {
        const isLinked = linked.has(s.id)
        const isTog    = toggling.has(s.id)
        return (
          <button key={s.id} onClick={() => void toggle(s.id)} disabled={isTog}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50">
            <div className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all",
              isLinked ? "bg-mota-600 border-mota-600" : "border-[var(--border-color)]")}>
              {isTog ? <Loader2 size={10} className="animate-spin text-white" />
                : isLinked ? <Check size={10} className="text-white" /> : null}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{s.name}</p>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{s.type}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── ChatInput ────────────────────────────────────────────────────────────────

export function ChatInput({
  selectedAgent, onAgentChange, onSend, agents, disabled,
  sessionId, companyId, onSourcesChanged,
}: ChatInputProps) {
  const [value, setValue]               = useState("")
  const [aiMode, setAiMode]             = useState<AIMode>("jarvis")
  const [aiModeOpen, setAiModeOpen]     = useState(false)
  const [sourcesOpen, setSourcesOpen]   = useState(false)
  const [slashAgents, setSlashAgents]   = useState<SlashAgentPublic[]>([])
  const [highlightIdx, setHighlightIdx] = useState(0)
  const [attachments, setAttachments]   = useState<PendingAttachment[]>([])
  const [uploadErr, setUploadErr]       = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Carrega slash agents na montagem
  useEffect(() => {
    fetch("/api/agents/slash")
      .then(async (r) => {
        if (!r.ok) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[slash-agents] API retornou", r.status, r.statusText)
          }
          return []
        }
        const json = await r.json() as unknown
        if (!Array.isArray(json)) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[slash-agents] resposta não é array:", json)
          }
          return []
        }
        if (process.env.NODE_ENV === "development") {
          console.log("[slash-agents] carregados:", json.length)
        }
        return json as SlashAgentPublic[]
      })
      .then((agents) => setSlashAgents(agents))
      .catch((err) => {
        if (process.env.NODE_ENV === "development") {
          console.error("[slash-agents] fetch falhou:", err)
        }
      })
  }, [])

  // Detecta se o input está no modo slash: só "/" ou "/letras" sem espaço
  const slashMatch      = /^\/([a-zA-Z0-9_-]*)$/.exec(value)
  const slashMenuActive = slashMatch !== null
  const slashFilter     = slashMatch ? slashMatch[1].toLowerCase() : ""
  const filteredCmds    = slashMenuActive
    ? slashAgents.filter(a => !slashFilter || a.command.startsWith(slashFilter))
    : []

  if (process.env.NODE_ENV === "development" && slashMenuActive) {
    // eslint-disable-next-line no-console
    console.log("[slash-menu] query:", JSON.stringify(slashFilter), "resultados:", filteredCmds.length)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (slashMenuActive && filteredCmds.length > 0) {
      if (e.key === "ArrowDown")  { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, filteredCmds.length - 1)); return }
      if (e.key === "ArrowUp")    { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectCommand(filteredCmds[highlightIdx]); return }
      if (e.key === "Escape")     { setValue(""); return }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit() }
  }

  function selectCommand(agent: SlashAgentPublic) {
    setValue(`/${agent.command} `)
    setHighlightIdx(0)
    textareaRef.current?.focus()
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value)
    setHighlightIdx(0)
    const el = textareaRef.current
    if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 140) + "px" }
  }

  // ── Anexos ─────────────────────────────────────────────────────────────────

  const ALLOWED_EXTS = ["txt", "md", "csv", "pdf", "png", "jpg", "jpeg", "webp", "gif"]
  const BLOCKED_EXTS = new Set(["exe", "bat", "cmd", "sh", "ps1", "js", "mjs", "dll", "jar", "scr"])

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ""
    setUploadErr(null)

    if (attachments.length + files.length > 5) {
      setUploadErr("Máximo 5 arquivos por mensagem.")
      return
    }

    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      if (BLOCKED_EXTS.has(ext)) { setUploadErr(`Arquivo bloqueado: .${ext}`); return }
      if (!ALLOWED_EXTS.includes(ext)) { setUploadErr(`Tipo não suportado: .${ext}`); return }
      if (file.size > 10 * 1024 * 1024) { setUploadErr(`"${file.name}" excede 10 MB.`); return }

      const tempId: string = `pending-${Date.now()}-${Math.random()}`
      const pending: PendingAttachment = { id: tempId, file, uploading: true }
      setAttachments(prev => [...prev, pending])

      // Upload
      const form = new FormData()
      form.append("files", file)
      const url = `/api/chat/upload?${new URLSearchParams({
        ...(companyId  ? { company_id:  companyId  } : {}),
        ...(sessionId  ? { session_id:  sessionId  } : {}),
      }).toString()}`

      try {
        const res  = await fetch(url, { method: "POST", body: form })
        const json = await res.json() as { attachments?: { id: string; warning?: string | null }[]; error?: string }

        if (!res.ok || json.error) {
          setAttachments(prev => prev.map(a => a.id === tempId ? { ...a, uploading: false, error: json.error ?? "Erro no upload" } : a))
        } else {
          const uploaded = json.attachments?.[0]
          setAttachments(prev => prev.map(a =>
            a.id === tempId ? { ...a, uploading: false, uploadedId: uploaded?.id, warning: uploaded?.warning } : a
          ))
        }
      } catch {
        setAttachments(prev => prev.map(a => a.id === tempId ? { ...a, uploading: false, error: "Erro de rede no upload" } : a))
      }
    }
  }

  function removeAttachment(tempId: string) {
    setAttachments(prev => prev.filter(a => a.id !== tempId))
  }

  async function submit() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    if (attachments.some(a => a.uploading)) { setUploadErr("Aguarde os uploads terminarem."); return }
    if (attachments.some(a => a.error))     { setUploadErr("Remova os arquivos com erro antes de enviar."); return }

    const uploadedIds = attachments.filter(a => a.uploadedId).map(a => a.uploadedId!)
    onSend(trimmed, aiMode, uploadedIds)
    setValue("")
    setAttachments([])
    setUploadErr(null)
    setHighlightIdx(0)
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  const currentAiMode = AI_MODE_LIST.find(m => m.id === aiMode) ?? AI_MODE_LIST[0]

  return (
    <div className="px-4 py-3 border-t shrink-0"
      style={{
        borderColor:    "var(--border-color)",
        background:     "var(--bg-sidebar)",
        paddingBottom:  "max(0.75rem, env(safe-area-inset-bottom))",
      }}>

      {/* ── Slash command menu ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {slashMenuActive && filteredCmds.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }} transition={{ duration: 0.12 }}
            className="mb-2 rounded-xl border shadow-xl overflow-hidden"
            style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
            <div className="px-3 py-2 border-b text-[10px] font-medium"
              style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}>
              Agentes — ↑↓ navegar · Enter selecionar · Esc fechar
            </div>
            <div className="p-1 max-h-56 overflow-y-auto">
              {filteredCmds.map((cmd, idx) => (
                <button key={cmd.command} onClick={() => selectCommand(cmd)}
                  className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors",
                    idx === highlightIdx ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]")}>
                  <span className="text-base shrink-0">{cmd.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{cmd.label}</span>
                      <span className="text-[10px] font-mono px-1 py-0.5 rounded"
                        style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa" }}>/{cmd.command}</span>
                    </div>
                    <p className="text-[10px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>{cmd.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Anexos pendentes ───────────────────────────────────────────────── */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map(att => (
            <div key={att.id}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px]"
              style={{
                background:  att.error ? "rgba(239,68,68,0.06)" : "var(--bg-card)",
                borderColor: att.error ? "rgba(239,68,68,0.3)" : "var(--border-color)",
              }}>
              {att.uploading
                ? <Loader2 size={11} className="animate-spin shrink-0" style={{ color: "var(--text-muted)" }} />
                : att.file.type.startsWith("image/")
                  ? <Image size={11} className="shrink-0" style={{ color: "var(--text-muted)" }} />
                  : <FileText size={11} className="shrink-0" style={{ color: "var(--text-muted)" }} />
              }
              <span className="truncate max-w-[140px]" style={{ color: att.error ? "#ef4444" : "var(--text-primary)" }}>
                {att.file.name}
              </span>
              {att.warning && !att.error && (
                <span className="text-[9px]" style={{ color: "#f59e0b" }}>⚠</span>
              )}
              {!att.uploading && (
                <button onClick={() => removeAttachment(att.id)}
                  className="shrink-0 hover:text-red-400 transition-colors"
                  style={{ color: "var(--text-muted)" }}>
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {uploadErr && (
        <p className="mb-1.5 text-[11px]" style={{ color: "#ef4444" }}>{uploadErr}</p>
      )}

      {/* ── Composer ───────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border transition-all"
        style={{ background: "var(--bg-input)", borderColor: "var(--border-color)" }}>

        <textarea ref={textareaRef} value={value} onChange={handleInput} onKeyDown={handleKeyDown}
          placeholder="Mensagem para o Jarvis... (/ para ativar agentes)"
          disabled={disabled} rows={1}
          inputMode="text" enterKeyHint="send"
          className={cn("w-full bg-transparent resize-none px-4 pt-3.5 pb-1 text-sm outline-none",
            "placeholder:text-[var(--text-muted)]", disabled && "opacity-50 cursor-not-allowed")}
          style={{ color: "var(--text-primary)", maxHeight: 140, minHeight: 44 }} />

        {/* Bottom bar */}
        <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
          {/* Esquerda: clipe + fontes */}
          <div className="flex items-center gap-1">
            {/* Anexo */}
            <>
              <input ref={fileInputRef} type="file" multiple accept=".txt,.md,.csv,.pdf,.png,.jpg,.jpeg,.webp,.gif"
                className="hidden" onChange={e => void handleFileSelect(e)} />
              <button onClick={() => fileInputRef.current?.click()}
                disabled={disabled || attachments.length >= 5}
                className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
                style={{ color: attachments.length > 0 ? "#3b82f6" : "var(--text-muted)" }}
                title="Anexar arquivo">
                <Paperclip size={14} />
              </button>
            </>

            {/* Fontes */}
            <div className="relative">
              <button onClick={() => setSourcesOpen((v) => !v)}
                className={cn("w-7 h-7 flex items-center justify-center rounded-lg transition-colors",
                  sourcesOpen ? "bg-mota-600/15 text-mota-500" : "hover:bg-[var(--bg-hover)]")}
                style={{ color: sourcesOpen ? undefined : "var(--text-muted)" }}
                title="Selecionar fontes">
                <Database size={14} />
              </button>
              <AnimatePresence>
                {sourcesOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setSourcesOpen(false)} />
                    <motion.div initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.97 }} transition={{ duration: 0.12 }}
                      className="absolute bottom-full left-0 mb-2 w-72 rounded-xl border shadow-xl z-40 overflow-hidden"
                      style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
                      <div className="flex items-center justify-between px-3 py-2.5 border-b"
                        style={{ borderColor: "var(--border-color)" }}>
                        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                          Fontes de conhecimento
                        </span>
                        <button onClick={() => setSourcesOpen(false)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]"
                          style={{ color: "var(--text-muted)" }}>
                          <X size={12} />
                        </button>
                      </div>
                      <SourcesPopup sessionId={sessionId} companyId={companyId} onSourcesChanged={onSourcesChanged} />
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex-1" />

          {/* Agent selector (opcional — mostra apenas se houver agentes) */}
          {agents && agents.length > 0 && selectedAgent && (
            <AgentSelector selected={selectedAgent} onChange={onAgentChange} agents={agents} />
          )}

          {/* ── Seletor de IA ──────────────────────────────────────────────── */}
          <div className="relative">
            <button onClick={() => setAiModeOpen((v) => !v)}
              className={cn("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-all",
                aiModeOpen && "border-mota-600/40")}
              style={{
                background:  "var(--bg-card)",
                borderColor: aiModeOpen ? undefined : "var(--border-color)",
                color:       "var(--text-secondary)",
              }}>
              <span>{currentAiMode.icon}</span>
              {currentAiMode.label}
              <motion.div animate={{ rotate: aiModeOpen ? 180 : 0 }} transition={{ duration: 0.15 }}>
                <ChevronDown size={11} />
              </motion.div>
            </button>

            {aiModeOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setAiModeOpen(false)} />
                <motion.div initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  className="absolute bottom-full right-0 mb-2 w-52 rounded-xl border shadow-xl z-40 overflow-hidden"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
                  <div className="p-1">
                    {AI_MODE_LIST.map((m) => (
                      <button key={m.id} onClick={() => { setAiMode(m.id); setAiModeOpen(false) }}
                        className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-[var(--bg-hover)]">
                        <span className="text-base shrink-0 mt-0.5">{m.icon}</span>
                        <div className="flex-1">
                          <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{m.label}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{m.description}</p>
                        </div>
                        {aiMode === m.id && <Check size={13} className="text-mota-500 shrink-0 mt-0.5" />}
                      </button>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </div>

          {/* Send */}
          <motion.button onClick={() => void submit()} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            disabled={!value.trim() || disabled}
            className={cn("w-8 h-8 flex items-center justify-center rounded-xl transition-all",
              value.trim() && !disabled
                ? "bg-mota-600 hover:bg-mota-700 text-white shadow-sm"
                : "text-[var(--text-muted)] cursor-not-allowed")}
            style={!value.trim() || disabled ? { background: "var(--bg-hover)" } : {}}>
            <Send size={14} />
          </motion.button>
        </div>
      </div>

      <p className="text-[10px] text-center mt-1.5" style={{ color: "var(--text-muted)" }}>
        Enter para enviar · Shift+Enter para nova linha
      </p>
    </div>
  )
}
