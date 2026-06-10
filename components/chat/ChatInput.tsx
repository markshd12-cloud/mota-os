"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Paperclip, Database, Send, ChevronDown, Check, X, Loader2, FileText, Image, Download,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { AgentSelector } from "./AgentSelector"
import type { AgentWithConfig } from "@/hooks/useAgents"
import { AI_MODE_LIST, type AIMode } from "@/lib/ai/model-registry"

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
  selectedAgent?:    AgentWithConfig | null
  onAgentChange:     (a: AgentWithConfig) => void
  onSend:            (text: string, aiMode: AIMode, attachmentIds: string[], pendingSourceIds?: string[], notionPageIds?: string[]) => void
  agents?:           AgentWithConfig[]
  disabled?:         boolean
  sessionId?:        string | null
  companyId?:        string
  onSourcesChanged?: () => void
}

// ─── Sources popup ────────────────────────────────────────────────────────────

function SourcesPopup({ sessionId, companyId, onSourcesChanged, pendingIds, onPendingToggle }: {
  sessionId?: string | null
  companyId?: string
  onSourcesChanged?: () => void
  pendingIds?: string[]
  onPendingToggle?: (id: string, linked: boolean) => void
}) {
  const [sources, setSources]   = useState<KnowledgeSource[]>([])
  const [linked, setLinked]     = useState<Set<string>>(() => !sessionId ? new Set(pendingIds ?? []) : new Set())
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
    const isLinked = linked.has(sourceId)

    if (!sessionId) {
      // Pré-sessão: atualiza estado local e notifica pai com os IDs pendentes
      setLinked((prev) => {
        const next = new Set(prev)
        if (isLinked) next.delete(sourceId)
        else next.add(sourceId)
        return next
      })
      onPendingToggle?.(sourceId, !isLinked)
      return
    }

    setToggling((prev) => new Set([...prev, sourceId]))
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

// ─── Notion icon (SVG) ───────────────────────────────────────────────────────

function NotionIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.047.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933z" />
    </svg>
  )
}

// ─── Notion popup ─────────────────────────────────────────────────────────────

interface NotionPageItem {
  id:               string
  title:            string
  type:             "page" | "database"
  icon:             string | null
  last_edited_time: string
}

function NotionPopup({ companyId, selectedIds, onToggle, onSaveAsSource }: {
  companyId?:       string
  selectedIds:      Set<string>
  onToggle:         (id: string, title: string) => void
  onSaveAsSource:   (id: string, title: string) => Promise<boolean>
}) {
  const [pages, setPages]               = useState<NotionPageItem[]>([])
  const [loading, setLoading]           = useState(true)
  const [searching, setSearching]       = useState(false)
  const [query, setQuery]               = useState("")
  const [notConnected, setNotConnected] = useState(false)
  const [savingId, setSavingId]         = useState<string | null>(null)
  const [savedIds, setSavedIds]         = useState<Set<string>>(new Set())
  const [saveError, setSaveError]       = useState<string | null>(null)
  const [error, setError]               = useState<string | null>(null)
  const debounceRef                     = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (q = "") => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setError(null)
    const res = await fetch(`/api/notion/pages?company_id=${encodeURIComponent(companyId)}&q=${encodeURIComponent(q)}`)
    if (res.status === 404) { setNotConnected(true); setLoading(false); return }
    if (!res.ok) { setError("Erro ao carregar páginas do Notion."); setLoading(false); return }
    const data = await res.json() as { pages: NotionPageItem[] }
    setPages(data.pages ?? [])
    setLoading(false)
  }, [companyId])

  useEffect(() => { void load() }, [load])

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQuery(v)
    setSearching(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearching(false)
      void load(v)
    }, 3000)
  }

  async function handleSave(page: NotionPageItem) {
    setSavingId(page.id)
    setSaveError(null)
    const ok = await onSaveAsSource(page.id, page.title)
    if (ok) {
      setSavedIds(prev => new Set([...prev, page.id]))
    } else {
      setSaveError(`Erro ao salvar "${page.title}". Verifique a conexão e tente novamente.`)
      setTimeout(() => setSaveError(null), 4000)
    }
    setSavingId(null)
  }

  if (notConnected) return (
    <div className="px-3 py-4 text-center space-y-2">
      <NotionIcon size={20} />
      <p className="text-xs" style={{ color: "var(--text-primary)" }}>Notion não conectado</p>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Conecte o Notion em Configurações → Integrações de API.
      </p>
    </div>
  )

  if (loading) return (
    <div className="flex items-center justify-center py-5 gap-2">
      <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>Carregando...</span>
    </div>
  )

  if (error) return (
    <p className="text-xs px-3 py-4 text-center" style={{ color: "#ef4444" }}>{error}</p>
  )

  return (
    <div>
      <div className="px-3 pb-2">
        <div className="relative">
          <input
            type="text" value={query} onChange={handleSearch}
            placeholder="Buscar páginas..." autoFocus
            className="w-full text-xs px-2.5 py-1.5 rounded-lg border outline-none pr-7"
            style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
          />
          {searching && (
            <Loader2 size={11} className="animate-spin absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }} />
          )}
        </div>
        {searching && (
          <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
            Aguardando 3s para buscar...
          </p>
        )}
        {saveError && (
          <p className="text-[10px] mt-1" style={{ color: "#ef4444" }}>{saveError}</p>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {pages.length === 0 ? (
          <p className="text-xs px-3 py-3 text-center" style={{ color: "var(--text-muted)" }}>
            Nenhuma página encontrada.
          </p>
        ) : pages.map((p) => {
          const isSelected = selectedIds.has(p.id)
          const isSaved    = savedIds.has(p.id)
          return (
            <div key={p.id} className="flex items-center gap-1 px-1 py-0.5 rounded-lg hover:bg-[var(--bg-hover)]">
              <button
                onClick={() => onToggle(p.id, p.title)}
                className="flex-1 flex items-center gap-2 text-left py-1.5 px-1.5">
                <div className={cn(
                  "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all",
                  isSelected ? "bg-mota-600 border-mota-600" : "border-[var(--border-color)]"
                )}>
                  {isSelected && <Check size={10} className="text-white" />}
                </div>
                <span className="text-[11px] shrink-0">{p.icon ?? (p.type === "database" ? "🗄️" : "📄")}</span>
                <p className="text-xs truncate flex-1" style={{ color: "var(--text-primary)" }}>{p.title}</p>
              </button>
              <button
                onClick={() => void handleSave(p)}
                disabled={savingId === p.id || isSaved}
                title={isSaved ? "Salvo como fonte" : "Salvar como fonte de conhecimento"}
                className="w-6 h-6 flex items-center justify-center rounded shrink-0 transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
                style={{ color: isSaved ? "#22c55e" : "var(--text-muted)" }}>
                {savingId === p.id
                  ? <Loader2 size={11} className="animate-spin" />
                  : isSaved ? <Check size={11} /> : <Download size={11} />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── ChatInput ────────────────────────────────────────────────────────────────

export function ChatInput({
  selectedAgent, onAgentChange, onSend, agents, disabled,
  sessionId, companyId, onSourcesChanged,
}: ChatInputProps) {
  const [value, setValue]                         = useState("")
  const [aiMode, setAiMode]                       = useState<AIMode>("jarvis")
  const [aiModeOpen, setAiModeOpen]               = useState(false)
  const [sourcesOpen, setSourcesOpen]             = useState(false)
  const [notionOpen, setNotionOpen]               = useState(false)
  const [pendingSourceIds, setPendingSourceIds]   = useState<string[]>([])
  const [notionPageIds, setNotionPageIds]         = useState<Map<string, string>>(new Map()) // id → title
  const [notionActionMsg, setNotionActionMsg]     = useState<string | null>(null)
  const [highlightIdx, setHighlightIdx]         = useState(0)
  const [attachments, setAttachments]           = useState<PendingAttachment[]>([])
  const [uploadErr, setUploadErr]               = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Limpa fontes pendentes quando a sessão é criada (fontes já vinculadas pelo backend)
  useEffect(() => {
    if (sessionId) setPendingSourceIds([])
  }, [sessionId])

  function handlePendingToggle(id: string, linked: boolean) {
    setPendingSourceIds((prev) =>
      linked ? [...prev, id] : prev.filter((x) => x !== id)
    )
  }

  function handleNotionToggle(id: string, title: string) {
    setNotionPageIds((prev) => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, title)
      return next
    })
  }

  async function handleNotionSaveAsSource(id: string, title: string): Promise<boolean> {
    if (!companyId) return false
    try {
      const res = await fetch(`/api/notion/page/${id}?company_id=${encodeURIComponent(companyId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId }),
      })
      if (res.ok) {
        setNotionActionMsg(`"${title}" salvo como fonte de conhecimento.`)
        onSourcesChanged?.()
        setTimeout(() => setNotionActionMsg(null), 3000)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  // Detecta se o input está no modo slash: só "/" ou "/texto" sem espaço.
  // O menu "/" lista os AGENTES da empresa atual (não comandos pré-prontos).
  const slashMatch      = /^\/([a-zA-Z0-9_-]*)$/.exec(value)
  const slashMenuActive = slashMatch !== null
  const slashFilter     = slashMatch ? slashMatch[1].toLowerCase() : ""
  const activeAgents    = (agents ?? []).filter(a => a.status === "active")
  const filteredCmds    = slashMenuActive
    ? activeAgents.filter(a => {
        if (!slashFilter) return true
        return `${a.shortName} ${a.name} ${a.id}`.toLowerCase().includes(slashFilter)
      })
    : []

  function handleKeyDown(e: React.KeyboardEvent) {
    if (slashMenuActive && filteredCmds.length > 0) {
      if (e.key === "ArrowDown")  { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, filteredCmds.length - 1)); return }
      if (e.key === "ArrowUp")    { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); selectCommand(filteredCmds[highlightIdx]); return }
      if (e.key === "Escape")     { setValue(""); return }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit() }
  }

  // Selecionar via "/" ativa o agente (carrega prompt + memória via agent_id) e limpa o texto.
  function selectCommand(agent: AgentWithConfig) {
    onAgentChange(agent)
    setValue("")
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

    const uploadedIds    = attachments.filter(a => a.uploadedId).map(a => a.uploadedId!)
    const currentPending = pendingSourceIds
    const currentNotion  = notionPageIds
    onSend(trimmed, aiMode, uploadedIds, currentPending.length > 0 ? currentPending : undefined, currentNotion.size > 0 ? [...currentNotion.keys()] : undefined)
    setValue("")
    setAttachments([])
    setNotionPageIds(new Map())
    setUploadErr(null)
    setHighlightIdx(0)
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  const currentAiMode = AI_MODE_LIST.find(m => m.id === aiMode) ?? AI_MODE_LIST[0]

  return (
    <div className="px-4 py-3 border-t shrink-0"
      style={{ borderColor: "var(--border-color)", background: "var(--bg-sidebar)" }}>

      {/* ── Menu de agentes (/) — apenas agentes da empresa atual ──────────── */}
      <AnimatePresence>
        {slashMenuActive && (
          <motion.div initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }} transition={{ duration: 0.12 }}
            className="mb-2 rounded-xl border shadow-xl overflow-hidden"
            style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
            <div className="px-3 py-2 border-b text-[10px] font-medium"
              style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}>
              Agentes desta empresa — ↑↓ navegar · Enter selecionar · Esc fechar
            </div>
            {filteredCmds.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
                {activeAgents.length === 0
                  ? "Nenhum agente vinculado a esta empresa."
                  : "Nenhum agente corresponde à busca."}
              </p>
            ) : (
              <div className="p-1 max-h-56 overflow-y-auto">
                {filteredCmds.map((agent, idx) => {
                  const Icon = agent.icon
                  return (
                    <button key={agent.dbId} onClick={() => selectCommand(agent)}
                      className={cn("w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors",
                        idx === highlightIdx ? "bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]")}>
                      <span className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ background: agent.bg }}>
                        <Icon size={14} style={{ color: agent.color }} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                          {agent.shortName || agent.name}
                        </span>
                        <p className="text-[10px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {agent.description}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
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

      {/* ── Páginas Notion selecionadas ────────────────────────────────────── */}
      {notionPageIds.size > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {[...notionPageIds.entries()].map(([id, title]) => (
            <div key={id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px]"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
              <NotionIcon size={11} />
              <span className="truncate max-w-[140px]" style={{ color: "var(--text-primary)" }}>{title}</span>
              <button onClick={() => handleNotionToggle(id, title)}
                className="shrink-0 hover:text-red-400 transition-colors"
                style={{ color: "var(--text-muted)" }}>
                <X size={10} />
              </button>
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
                style={{ color: sourcesOpen ? undefined : pendingSourceIds.length > 0 ? "#3b82f6" : "var(--text-muted)" }}
                title="Selecionar fontes">
                <Database size={14} />
                {!sessionId && pendingSourceIds.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center text-white"
                    style={{ background: "#3b82f6" }}>
                    {pendingSourceIds.length}
                  </span>
                )}
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
                        {!sessionId && pendingSourceIds.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>
                            {pendingSourceIds.length} selecionada{pendingSourceIds.length > 1 ? "s" : ""}
                          </span>
                        )}
                        <button onClick={() => setSourcesOpen(false)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]"
                          style={{ color: "var(--text-muted)" }}>
                          <X size={12} />
                        </button>
                      </div>
                      <SourcesPopup
                        sessionId={sessionId}
                        companyId={companyId}
                        onSourcesChanged={onSourcesChanged}
                        pendingIds={pendingSourceIds}
                        onPendingToggle={handlePendingToggle}
                      />
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

            {/* Notion */}
            <div className="relative">
              <button onClick={() => { setNotionOpen((v) => !v); setSourcesOpen(false) }}
                className={cn("w-7 h-7 flex items-center justify-center rounded-lg transition-colors",
                  notionOpen ? "bg-[#00000015] text-black dark:bg-white/10 dark:text-white" : "hover:bg-[var(--bg-hover)]")}
                style={{ color: notionOpen ? undefined : notionPageIds.size > 0 ? "var(--text-primary)" : "var(--text-muted)" }}
                title="Selecionar páginas do Notion">
                <NotionIcon size={14} />
                {notionPageIds.size > 0 && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center text-white"
                    style={{ background: "var(--text-primary)" }}>
                    {notionPageIds.size}
                  </span>
                )}
              </button>
              <AnimatePresence>
                {notionOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setNotionOpen(false)} />
                    <motion.div initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.97 }} transition={{ duration: 0.12 }}
                      className="absolute bottom-full left-0 mb-2 w-80 rounded-xl border shadow-xl z-40 overflow-hidden"
                      style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
                      <div className="flex items-center justify-between px-3 py-2.5 border-b"
                        style={{ borderColor: "var(--border-color)" }}>
                        <div className="flex items-center gap-2">
                          <NotionIcon size={13} />
                          <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                            Notion
                          </span>
                          {notionPageIds.size > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                              style={{ background: "rgba(0,0,0,0.06)", color: "var(--text-secondary)" }}>
                              {notionPageIds.size} selecionada{notionPageIds.size > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                        <button onClick={() => setNotionOpen(false)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)]"
                          style={{ color: "var(--text-muted)" }}>
                          <X size={12} />
                        </button>
                      </div>
                      {notionActionMsg && (
                        <div className="px-3 py-2 text-[11px]" style={{ color: "#16a34a", background: "rgba(22,163,74,0.06)" }}>
                          {notionActionMsg}
                        </div>
                      )}
                      <NotionPopup
                        companyId={companyId}
                        selectedIds={new Set(notionPageIds.keys())}
                        onToggle={handleNotionToggle}
                        onSaveAsSource={handleNotionSaveAsSource}
                      />
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
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
