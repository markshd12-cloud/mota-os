"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Database, Plus, Search, BookOpen, HelpCircle,
  FileText, Package, AlertTriangle, File, Link as LinkIcon,
  X, Upload, Edit2, Archive, Eye, Loader2, Zap,
} from "lucide-react"
import { PageHeader } from "@/components/ui/PageHeader"
import { EmptyState } from "@/components/ui/EmptyState"
import { useCompany } from "@/components/providers/CompanyProvider"
import { cn } from "@/lib/utils"

interface KnowledgeSource {
  id:               string
  company_id:       string
  name:             string
  description:      string | null
  type:             string
  status:           "active" | "archived"
  content:          string | null
  metadata:         Record<string, unknown>
  created_by:       string | null
  created_at:       string
  updated_at:       string
  embedding_status: string | null
  content_hash:     string | null
}

const TYPE_LABELS: Record<string, string> = {
  playbook:         "Playbook",
  faq:              "FAQ",
  script:           "Script",
  product_info:     "Produto/Info",
  brand_voice:      "Tom de Voz",
  offer:            "Oferta",
  objection:        "Objeção",
  competitor:       "Concorrente",
  internal_process: "Processo",
  document:         "Documento",
  link:             "Link",
  manual_note:      "Nota",
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

const TYPE_COLORS: Record<string, string> = {
  playbook:         "#3b82f6",
  faq:              "#8b5cf6",
  script:           "#06b6d4",
  product_info:     "#f97316",
  brand_voice:      "#ec4899",
  offer:            "#22c55e",
  objection:        "#ef4444",
  competitor:       "#f59e0b",
  internal_process: "#6b7280",
  document:         "#64748b",
  link:             "#0ea5e9",
  manual_note:      "#a78bfa",
}

const VALID_TYPES = [
  "playbook", "faq", "script", "product_info", "brand_voice",
  "offer", "objection", "competitor", "internal_process",
  "document", "link", "manual_note",
] as const

type FilterValue = "all" | "playbook" | "faq" | "script" | "product" | "objection" | "document" | "link"

const TYPE_FILTERS: { label: string; value: FilterValue; types?: string[] }[] = [
  { label: "Todos",      value: "all" },
  { label: "Playbooks",  value: "playbook",  types: ["playbook"] },
  { label: "FAQ",        value: "faq",       types: ["faq"] },
  { label: "Scripts",    value: "script",    types: ["script"] },
  { label: "Produtos",   value: "product",   types: ["product_info", "offer", "brand_voice"] },
  { label: "Objeções",   value: "objection", types: ["objection", "competitor"] },
  { label: "Documentos", value: "document",  types: ["document", "manual_note", "internal_process"] },
  { label: "Links",      value: "link",      types: ["link"] },
]

// ─── Embedding status badge ───────────────────────────────────────────────────

function EmbeddingBadge({ status }: { status: string | null }) {
  if (!status || status === "pending") return (
    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
      style={{ background: "rgba(156,163,175,0.12)", color: "var(--text-muted)" }}>
      Sem índice
    </span>
  )
  if (status === "processing") return (
    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1"
      style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>
      <Loader2 size={8} className="animate-spin" /> Indexando
    </span>
  )
  if (status === "done") return (
    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
      style={{ background: "rgba(34,197,94,0.12)", color: "#4ade80" }}>
      Indexado
    </span>
  )
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
      style={{ background: "rgba(239,68,68,0.12)", color: "#f87171" }}>
      Erro
    </span>
  )
}

// ─── Source card ──────────────────────────────────────────────────────────────

function SourceCard({ source, index, onEdit, onArchive, onView, onReindexed }: {
  source:      KnowledgeSource
  index:       number
  onEdit:      (s: KnowledgeSource) => void
  onArchive:   (id: string) => void
  onView:      (s: KnowledgeSource) => void
  onReindexed: (id: string, status: string) => void
}) {
  const Icon  = TYPE_ICONS[source.type] ?? FileText
  const color = TYPE_COLORS[source.type] ?? "#6b7280"
  const label = TYPE_LABELS[source.type] ?? source.type
  const [indexing, setIndexing] = useState(false)

  async function handleIndex(force = false) {
    if (indexing || !source.content) return
    setIndexing(true)
    onReindexed(source.id, "processing")
    try {
      const res = await fetch("/api/rag/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: "knowledge_source", source_id: source.id, force }),
      })
      const json = await res.json() as { ok?: boolean; error?: string }
      onReindexed(source.id, res.ok && json.ok ? "done" : "error")
    } catch {
      onReindexed(source.id, "error")
    } finally {
      setIndexing(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.04 }}
      className="rounded-2xl border flex flex-col overflow-hidden"
      style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
    >
      <div className="p-5 flex flex-col gap-3 flex-1">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${color}15` }}
          >
            <Icon size={18} style={{ color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>
                {source.name}
              </p>
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                style={{ background: `${color}15`, color }}
              >
                {label}
              </span>
            </div>
            {source.description && (
              <p className="text-[11px] mt-0.5 line-clamp-2 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {source.description}
              </p>
            )}
          </div>
        </div>

        {source.content && (
          <p className="text-xs leading-relaxed line-clamp-3" style={{ color: "var(--text-secondary)" }}>
            {source.content}
          </p>
        )}

        <div className="flex items-center justify-between">
          <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            Atualizado em {new Date(source.updated_at).toLocaleDateString("pt-BR")}
          </p>
          <EmbeddingBadge status={source.embedding_status} />
        </div>
      </div>

      <div
        className="flex items-center gap-2 px-5 py-3 border-t"
        style={{ borderColor: "var(--border-color)" }}
      >
        <button
          onClick={() => onView(source)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-all flex-1 justify-center hover:bg-[var(--bg-hover)]"
          style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
        >
          <Eye size={12} /> Ver
        </button>
        {source.content && (
          <button
            onClick={() => handleIndex(source.embedding_status === "done")}
            disabled={indexing || source.embedding_status === "processing"}
            className="w-8 h-8 flex items-center justify-center rounded-lg border transition-all hover:bg-[var(--bg-hover)] disabled:opacity-40"
            style={{ borderColor: "var(--border-color)", color: source.embedding_status === "done" ? "#4ade80" : "var(--text-muted)" }}
            title={source.embedding_status === "done" ? "Reindexar" : "Indexar para busca semântica"}
          >
            {indexing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
          </button>
        )}
        <button
          onClick={() => onEdit(source)}
          className="w-8 h-8 flex items-center justify-center rounded-lg border transition-all hover:bg-[var(--bg-hover)]"
          style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
          title="Editar"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={() => onArchive(source.id)}
          className="w-8 h-8 flex items-center justify-center rounded-lg border transition-all hover:bg-red-500/10 hover:border-red-500/20"
          style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
          title="Arquivar"
        >
          <Archive size={13} />
        </button>
      </div>
    </motion.div>
  )
}

// ─── Create / Edit modal ──────────────────────────────────────────────────────

function SourceModal({ source, companyId, onClose, onSave }: {
  source: KnowledgeSource | null
  companyId: string
  onClose: () => void
  onSave: (s: KnowledgeSource) => void
}) {
  const isEdit = !!source
  const [name, setName]       = useState(source?.name ?? "")
  const [type, setType]       = useState(source?.type ?? "playbook")
  const [desc, setDesc]       = useState(source?.description ?? "")
  const [content, setContent] = useState(source?.content ?? "")
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState("")

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim()) { setError("Nome obrigatório"); return }
    setSaving(true)
    setError("")

    const method = isEdit ? "PATCH" : "POST"
    const body   = isEdit
      ? { id: source!.id, name: name.trim(), description: desc, content, type }
      : { company_id: companyId, name: name.trim(), type, description: desc, content }

    const res = await fetch("/api/knowledge-sources", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({})) as { error?: string }
      setError(json.error ?? "Erro ao salvar")
      setSaving(false)
      return
    }

    const saved = await res.json() as KnowledgeSource
    onSave(saved)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden z-10"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--border-color)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {isEdit ? "Editar fonte" : "Nova fonte de conhecimento"}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Nome *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Playbook de Vendas CPPEM"
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-mota-500 transition-colors"
              style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Tipo *</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none"
              style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
            >
              {VALID_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Descrição</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Breve descrição desta fonte"
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-mota-500 transition-colors"
              style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Conteúdo</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Cole o texto do playbook, FAQ, script..."
              rows={6}
              className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none resize-none focus:border-mota-500 transition-colors"
              style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors hover:bg-[var(--bg-hover)]"
              style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-mota-600 hover:bg-mota-700 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              {isEdit ? "Salvar alterações" : "Criar fonte"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// ─── View modal ───────────────────────────────────────────────────────────────

function ViewModal({ source, onClose, onEdit }: {
  source: KnowledgeSource
  onClose: () => void
  onEdit: () => void
}) {
  const Icon  = TYPE_ICONS[source.type] ?? FileText
  const color = TYPE_COLORS[source.type] ?? "#6b7280"
  const label = TYPE_LABELS[source.type] ?? source.type

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-2xl max-h-[80vh] rounded-2xl border shadow-2xl overflow-hidden z-10 flex flex-col"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        <div
          className="flex items-center gap-3 px-5 py-4 border-b shrink-0"
          style={{ borderColor: "var(--border-color)" }}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${color}15` }}
          >
            <Icon size={16} style={{ color }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {source.name}
            </h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {label}{source.description ? ` · ${source.description}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)]"
              style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
            >
              <Edit2 size={12} /> Editar
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)]"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {source.content ? (
            <pre
              className="text-xs leading-relaxed whitespace-pre-wrap font-sans"
              style={{ color: "var(--text-primary)" }}
            >
              {source.content}
            </pre>
          ) : (
            <p className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
              Esta fonte não possui conteúdo de texto.
            </p>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ─── Upload modal ─────────────────────────────────────────────────────────────

function UploadModal({ companyId, onClose, onUploaded }: {
  companyId: string
  onClose: () => void
  onUploaded: () => void
}) {
  const [file, setFile]         = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError]       = useState("")
  const [warning, setWarning]   = useState("")
  const [done, setDone]         = useState(false)

  async function handleUpload(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) return
    setUploading(true)
    setError("")
    setWarning("")

    const form = new FormData()
    form.append("file", file)
    form.append("company_id", companyId)

    const res = await fetch("/api/source-files/upload", { method: "POST", body: form })
    const json = await res.json().catch(() => ({})) as { error?: string; warning?: string }

    if (!res.ok) {
      setError(json.error ?? "Erro ao enviar arquivo")
      setUploading(false)
      return
    }

    if (json.warning) setWarning(json.warning)
    setDone(true)
    setUploading(false)
    setTimeout(() => { onUploaded(); onClose() }, 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden z-10"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--border-color)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Upload de arquivo
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleUpload} className="p-5 space-y-4">
          <button
            type="button"
            onClick={() => document.getElementById("upload-file-input")?.click()}
            className="w-full flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-dashed transition-colors hover:border-mota-500/40"
            style={{ borderColor: "var(--border-color)" }}
          >
            <Upload size={24} style={{ color: "var(--text-muted)" }} />
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {file ? file.name : "Clique para selecionar"}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                TXT, MD, CSV, JSON, PDF · Máximo 10 MB
              </p>
            </div>
          </button>
          <input
            id="upload-file-input"
            type="file"
            accept=".txt,.md,.csv,.json,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf"
            className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError("") }}
          />

          {error   && <p className="text-xs text-red-400">{error}</p>}
          {warning && <p className="text-xs text-yellow-400">{warning}</p>}
          {done    && <p className="text-xs text-mota-400">Arquivo enviado com sucesso!</p>}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border text-sm font-medium hover:bg-[var(--bg-hover)]"
              style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!file || uploading || done}
              className="flex-1 py-2.5 rounded-xl bg-mota-600 hover:bg-mota-700 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {uploading && <Loader2 size={13} className="animate-spin" />}
              Enviar
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SourcesPage() {
  const { currentCompany } = useCompany()
  const companyId = currentCompany?.slug

  const [sources, setSources]       = useState<KnowledgeSource[]>([])
  const [loading, setLoading]       = useState(false)
  const [typeFilter, setTypeFilter] = useState<FilterValue>("all")
  const [search, setSearch]         = useState("")
  const [editSource, setEditSource] = useState<KnowledgeSource | "new" | null>(null)
  const [viewSource, setViewSource] = useState<KnowledgeSource | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const load = useCallback(async () => {
    if (!companyId) { setSources([]); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/knowledge-sources?company_id=${encodeURIComponent(companyId)}`)
      if (res.ok) setSources(await res.json() as KnowledgeSource[])
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { void load() }, [load])

  async function handleArchive(id: string) {
    if (!confirm("Arquivar esta fonte? Ela não ficará mais disponível nos chats.")) return
    const res = await fetch(`/api/knowledge-sources/${id}`, { method: "DELETE" })
    if (res.ok) setSources((prev) => prev.filter((s) => s.id !== id))
  }

  function handleSaved(saved: KnowledgeSource) {
    setSources((prev) => {
      const idx = prev.findIndex((s) => s.id === saved.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next }
      return [saved, ...prev]
    })
    setEditSource(null)
  }

  const filtered = sources.filter((s) => {
    const filterDef = TYPE_FILTERS.find((f) => f.value === typeFilter)
    const matchType = typeFilter === "all" || (filterDef?.types?.includes(s.type) ?? false)
    const matchSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.description ?? "").toLowerCase().includes(search.toLowerCase())
    return matchType && matchSearch
  })

  const stats = [
    { label: "Total",      value: sources.length,                                                              color: "#16a34a" },
    { label: "Playbooks",  value: sources.filter((s) => s.type === "playbook").length,                        color: "#3b82f6" },
    { label: "Documentos", value: sources.filter((s) => ["document", "manual_note"].includes(s.type)).length, color: "#8b5cf6" },
    { label: "Outros",     value: sources.filter((s) => !["playbook","document","manual_note"].includes(s.type)).length, color: "#f97316" },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Fontes de Conhecimento"
        subtitle={
          companyId
            ? `${sources.length} fonte${sources.length !== 1 ? "s" : ""} · ${currentCompany?.name}`
            : "Selecione uma empresa"
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowUpload(true)}
              disabled={!companyId}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
            >
              <Upload size={13} /> Upload
            </button>
            <button
              onClick={() => setEditSource("new")}
              disabled={!companyId}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={13} /> Nova fonte
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-screen-xl mx-auto space-y-5">

          {/* Stats */}
          {!loading && sources.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="rounded-xl p-4 border"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
                >
                  <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{stat.label}</p>
                </motion.div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div
              className="flex items-center gap-2 rounded-xl px-3 h-9 border flex-1 max-w-64"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
            >
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar fontes..."
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]"
                style={{ color: "var(--text-primary)" }}
              />
            </div>

            <div
              className="flex items-center gap-1 p-1 rounded-xl border flex-wrap"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
            >
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setTypeFilter(f.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                    typeFilter === f.value ? "bg-mota-600 text-white" : "hover:bg-[var(--bg-hover)]"
                  )}
                  style={{ color: typeFilter === f.value ? undefined : "var(--text-secondary)" }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-3">
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>Carregando fontes...</p>
            </div>
          ) : !companyId ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Database size={32} style={{ color: "var(--text-muted)" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Selecione uma empresa para ver as fontes
              </p>
            </div>
          ) : filtered.length === 0 ? (
            sources.length === 0 ? (
              <EmptyState
                icon={Database}
                title="Nenhuma fonte cadastrada"
                description="Adicione documentos, APIs e bases de conhecimento para enriquecer as respostas dos agentes."
                action={{
                  label:   "Criar primeira fonte",
                  icon:    Plus,
                  onClick: () => setEditSource("new"),
                }}
              />
            ) : (
              <EmptyState
                icon={Search}
                title="Nenhuma fonte encontrada"
                description="Tente outro termo de busca ou ajuste os filtros."
              />
            )
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((s, i) => (
                <SourceCard
                  key={s.id}
                  source={s}
                  index={i}
                  onEdit={setEditSource}
                  onArchive={handleArchive}
                  onView={setViewSource}
                  onReindexed={(id, status) =>
                    setSources(prev => prev.map(x => x.id === id ? { ...x, embedding_status: status } : x))
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {editSource !== null && companyId && (
          <SourceModal
            key="edit-modal"
            source={editSource === "new" ? null : editSource}
            companyId={companyId}
            onClose={() => setEditSource(null)}
            onSave={handleSaved}
          />
        )}
        {viewSource && (
          <ViewModal
            key="view-modal"
            source={viewSource}
            onClose={() => setViewSource(null)}
            onEdit={() => { setEditSource(viewSource); setViewSource(null) }}
          />
        )}
        {showUpload && companyId && (
          <UploadModal
            key="upload-modal"
            companyId={companyId}
            onClose={() => setShowUpload(false)}
            onUploaded={load}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
