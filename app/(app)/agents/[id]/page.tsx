"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
  ArrowLeft, Bot, Save, Trash2, Plus, X,
  Building2, FileText, Zap, Settings, Loader2,
} from "lucide-react"
import type { ApiAgent, ApiAgentFile, ApiAgentCompany } from "@/lib/agent-helpers"
import { cn } from "@/lib/utils"

type Tab = "geral" | "empresas" | "arquivos" | "capacidades"

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "geral",        label: "Geral",       icon: Bot       },
  { id: "empresas",     label: "Empresas",    icon: Building2 },
  { id: "arquivos",     label: "Memória",     icon: FileText  },
  { id: "capacidades",  label: "Capacidades", icon: Zap       },
]

const COMPANIES = ["grupo", "cppem", "unicive", "colegio", "everton"] as const

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()
  const [tab, setTab] = useState<Tab>("geral")

  const [agent,     setAgent]     = useState<ApiAgent | null>(null)
  const [companies, setCompanies] = useState<ApiAgentCompany[]>([])
  const [files,     setFiles]     = useState<ApiAgentFile[]>([])
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [agentRes, companiesRes, filesRes] = await Promise.all([
        fetch(`/api/agents/${id}`),
        fetch(`/api/agents/${id}/companies`),
        fetch(`/api/agents/${id}/files`),
      ])
      if (!agentRes.ok) throw new Error(`Agente não encontrado (${agentRes.status})`)
      setAgent(await agentRes.json())
      setCompanies(companiesRes.ok ? await companiesRes.json() : [])
      setFiles(filesRes.ok ? await filesRes.json() : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar agente")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingState />
  if (error || !agent) return <ErrorState error={error} onBack={() => router.push("/agents")} />

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header
        className="flex items-center gap-4 px-6 py-4 border-b shrink-0"
        style={{ borderColor: "var(--border-color)", background: "var(--bg-secondary)" }}
      >
        <button
          onClick={() => router.push("/agents")}
          className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowLeft size={16} />
        </button>
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "var(--bg-active)" }}
        >
          <Bot size={16} className="text-mota-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
            {agent.name}
          </h1>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {agent.status}
          </p>
        </div>
        <StatusBadge status={agent.status} />
      </header>

      {/* Tabs */}
      <div
        className="flex items-center gap-1 px-6 py-2 border-b shrink-0"
        style={{ borderColor: "var(--border-color)", background: "var(--bg-secondary)" }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
              tab === t.id ? "bg-mota-600 text-white" : "hover:bg-[var(--bg-hover)]"
            )}
            style={{ color: tab === t.id ? undefined : "var(--text-secondary)" }}
          >
            <t.icon size={12} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          {tab === "geral" && (
            <TabGeral agent={agent} saving={saving} onSave={async (patch) => {
              setSaving(true)
              const res = await fetch(`/api/agents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              })
              // O "Papel" (role_description) guia o agente → propaga para o system prompt,
              // já que a aba de modelo foi removida (o chat escolhe o modelo automaticamente).
              if ("role_description" in patch) {
                await fetch(`/api/agents/${id}/model-config`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ system_prompt: patch.role_description }),
                }).catch(() => null)
              }
              setSaving(false)
              if (res.ok) setAgent(await res.json())
            }} />
          )}
          {tab === "empresas" && (
            <TabEmpresas
              companies={companies}
              onAttach={async (companyId) => {
                const res = await fetch(`/api/agents/${id}/companies`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ company_id: companyId }),
                })
                if (res.ok) { const newCompany = await res.json(); setCompanies(c => [...c, newCompany]) }
              }}
              onDetach={async (companyId) => {
                await fetch(`/api/agents/${id}/companies`, {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ company_id: companyId }),
                })
                setCompanies(c => c.filter(x => x.company_id !== companyId))
              }}
            />
          )}
          {tab === "arquivos" && (
            <TabArquivos
              agentId={id}
              files={files}
              onUploaded={(f) => setFiles(prev => [...prev, f])}
              onDeleted={(fileId) => setFiles(prev => prev.filter(f => f.id !== fileId))}
              onFileUpdated={(fileId, patch) =>
                setFiles(prev => prev.map(f => f.id === fileId ? { ...f, ...patch } : f))
              }
            />
          )}
          {tab === "capacidades" && (
            <TabCapacidades agent={agent} saving={saving} onSave={async (patch) => {
              setSaving(true)
              const res = await fetch(`/api/agents/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              })
              setSaving(false)
              if (res.ok) setAgent(await res.json())
            }} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Geral ───────────────────────────────────────────────────────────────

function TabGeral({ agent, saving, onSave }: {
  agent: ApiAgent
  saving: boolean
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [form, setForm] = useState({
    name:             agent.name,
    description:      agent.description,
    role_description: agent.role_description ?? "",
    status:           agent.status,
    category:         agent.category ?? "",
  })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...form, category: form.category || null }) }}
      className="space-y-4">
      <Row label="Nome">
        <input className={inputCls} value={form.name} onChange={set("name")} required />
      </Row>
      <Row label="Descrição">
        <textarea className={inputCls} rows={2} value={form.description} onChange={set("description")} />
      </Row>
      <Row label="Descrição do papel">
        <textarea className={inputCls} rows={4} value={form.role_description} onChange={set("role_description")}
          placeholder="Descreva o papel e comportamento deste agente..." />
      </Row>
      <Row label="Categoria">
        <input className={inputCls} value={form.category} onChange={set("category")} placeholder="ex: Marketing, Suporte" />
      </Row>
      <Row label="Status">
        <select className={inputCls} value={form.status} onChange={set("status")}>
          <option value="active">Ativo</option>
          <option value="paused">Pausado</option>
          <option value="archived">Arquivado</option>
        </select>
      </Row>
      <SaveButton saving={saving} />
    </form>
  )
}

// ─── Tab: Empresas ────────────────────────────────────────────────────────────

function TabEmpresas({ companies, onAttach, onDetach }: {
  companies: ApiAgentCompany[]
  onAttach:  (companyId: string) => Promise<void>
  onDetach:  (companyId: string) => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const attached = new Set(companies.map(c => c.company_id))

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Defina em quais empresas este agente está disponível.
      </p>
      {COMPANIES.map((slug) => {
        const isAttached = attached.has(slug)
        return (
          <div
            key={slug}
            className="flex items-center justify-between rounded-xl border px-4 py-3"
            style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
          >
            <div className="flex items-center gap-3">
              <Building2 size={14} style={{ color: "var(--text-muted)" }} />
              <span className="text-sm font-medium capitalize" style={{ color: "var(--text-primary)" }}>{slug}</span>
            </div>
            <button
              disabled={busy === slug}
              onClick={async () => {
                setBusy(slug)
                if (isAttached) await onDetach(slug)
                else await onAttach(slug)
                setBusy(null)
              }}
              className={cn(
                "text-xs px-3 py-1.5 rounded-lg font-medium transition-colors",
                isAttached
                  ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                  : "bg-mota-600 text-white hover:bg-mota-700"
              )}
            >
              {busy === slug ? "..." : isAttached ? "Remover" : "Vincular"}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Embedding status badge (arquivos) ───────────────────────────────────────

function FileEmbeddingBadge({ status }: { status: string | null }) {
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

// ─── Tab: Arquivos / Memória ──────────────────────────────────────────────────

function TabArquivos({ agentId, files, onUploaded, onDeleted, onFileUpdated }: {
  agentId:       string
  files:         ApiAgentFile[]
  onUploaded:   (f: ApiAgentFile) => void
  onDeleted:    (id: string) => void
  onFileUpdated:(id: string, patch: Partial<ApiAgentFile>) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [preview,   setPreview]   = useState<ApiAgentFile | null>(null)
  const [deleting,  setDeleting]  = useState<string | null>(null)
  const [indexing,  setIndexing]  = useState<string | null>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch(`/api/agents/${agentId}/files/upload`, { method: "POST", body: fd })
    if (res.ok) onUploaded(await res.json())
    setUploading(false)
    e.target.value = ""
  }

  const handleIndex = async (f: ApiAgentFile, force = false) => {
    if (indexing || !f.extracted_text) return
    setIndexing(f.id)
    onFileUpdated(f.id, { embedding_status: "processing" })
    try {
      const res = await fetch("/api/rag/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: "agent_file", source_id: f.id, force }),
      })
      const json = await res.json() as { ok?: boolean }
      onFileUpdated(f.id, { embedding_status: res.ok && json.ok ? "done" : "error" })
    } catch {
      onFileUpdated(f.id, { embedding_status: "error" })
    } finally {
      setIndexing(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Upload */}
      <label
        className={cn(
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors",
          uploading ? "opacity-50 pointer-events-none" : "hover:border-mota-500"
        )}
        style={{ borderColor: "var(--border-color)" }}
      >
        <FileText size={24} style={{ color: "var(--text-muted)" }} />
        <p className="mt-2 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          {uploading ? "Enviando..." : "Clique ou arraste um arquivo"}
        </p>
        <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
          .md, .txt, .csv, .json, .html, .pdf · máx 20 MB
        </p>
        <input type="file" accept=".md,.txt,.csv,.json,.html,.htm,.pdf" className="hidden" onChange={handleUpload} />
      </label>

      {/* File list */}
      {files.length === 0 ? (
        <p className="text-center text-xs py-8" style={{ color: "var(--text-muted)" }}>
          Nenhum arquivo de memória ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-3 rounded-xl border px-4 py-3"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
            >
              <FileText size={14} style={{ color: "var(--text-muted)" }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                  {f.file_name}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {(f.file_size / 1024).toFixed(1)} KB · {f.file_type}
                    {f.extracted_text && ` · ${f.extracted_text.length.toLocaleString()} chars`}
                  </p>
                  <FileEmbeddingBadge status={f.embedding_status} />
                </div>
              </div>
              {f.extracted_text && (
                <button
                  disabled={indexing === f.id || f.embedding_status === "processing"}
                  onClick={() => handleIndex(f, f.embedding_status === "done")}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
                  style={{ color: f.embedding_status === "done" ? "#4ade80" : "var(--text-muted)" }}
                  title={f.embedding_status === "done" ? "Reindexar" : "Indexar para RAG"}
                >
                  {indexing === f.id ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                </button>
              )}
              <button
                className="text-xs px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
                style={{ color: "var(--text-muted)" }}
                onClick={() => setPreview(prev => prev?.id === f.id ? null : f)}
              >
                {preview?.id === f.id ? "Fechar" : "Ver"}
              </button>
              <button
                disabled={deleting === f.id}
                onClick={async () => {
                  setDeleting(f.id)
                  await fetch(`/api/agent-files/${f.id}`, { method: "DELETE" })
                  onDeleted(f.id)
                  setDeleting(null)
                }}
                className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Preview */}
      {preview?.extracted_text && (
        <div
          className="rounded-xl border p-4 font-mono text-[11px] max-h-64 overflow-y-auto whitespace-pre-wrap"
          style={{ background: "var(--bg-card)", borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
        >
          {preview.extracted_text}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Capacidades ─────────────────────────────────────────────────────────

function TabCapacidades({ agent, saving, onSave }: {
  agent: ApiAgent
  saving: boolean
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [capabilities, setCapabilities] = useState<string[]>(agent.capabilities)
  const [tools,        setTools]        = useState<string[]>(agent.tools)
  const [newCap,  setNewCap]  = useState("")
  const [newTool, setNewTool] = useState("")

  const addItem = (list: string[], setList: (v: string[]) => void, val: string) => {
    const v = val.trim()
    if (v && !list.includes(v)) setList([...list, v])
  }

  const removeItem = (list: string[], setList: (v: string[]) => void, val: string) =>
    setList(list.filter(x => x !== val))

  return (
    <div className="space-y-6">
      {/* Capabilities */}
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
          Capacidades
        </h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {capabilities.map(c => (
            <span
              key={c}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border"
              style={{ borderColor: "var(--border-color)", color: "var(--text-primary)" }}
            >
              {c}
              <button onClick={() => removeItem(capabilities, setCapabilities, c)}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className={cn(inputCls, "flex-1")}
            value={newCap}
            onChange={e => setNewCap(e.target.value)}
            placeholder="Nova capacidade..."
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addItem(capabilities, setCapabilities, newCap); setNewCap("") } }}
          />
          <button type="button"
            className="px-3 py-2 rounded-xl bg-mota-600 text-white hover:bg-mota-700 transition-colors"
            onClick={() => { addItem(capabilities, setCapabilities, newCap); setNewCap("") }}
          >
            <Plus size={14} />
          </button>
        </div>
      </section>

      {/* Tools */}
      <section>
        <h3 className="text-xs font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
          Ferramentas (tools)
        </h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {tools.map(t => (
            <span
              key={t}
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-mono"
              style={{ borderColor: "var(--border-color)", color: "var(--text-primary)" }}
            >
              {t}
              <button onClick={() => removeItem(tools, setTools, t)}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className={cn(inputCls, "flex-1 font-mono")}
            value={newTool}
            onChange={e => setNewTool(e.target.value)}
            placeholder="ex: web_search, code_interpreter"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addItem(tools, setTools, newTool); setNewTool("") } }}
          />
          <button type="button"
            className="px-3 py-2 rounded-xl bg-mota-600 text-white hover:bg-mota-700 transition-colors"
            onClick={() => { addItem(tools, setTools, newTool); setNewTool("") }}
          >
            <Plus size={14} />
          </button>
        </div>
      </section>

      <button
        disabled={saving}
        onClick={() => onSave({ capabilities, tools })}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-mota-600 hover:bg-mota-700 disabled:opacity-50 transition-colors"
      >
        <Save size={13} />
        {saving ? "Salvando..." : "Salvar capacidades"}
      </button>
    </div>
  )
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

const inputCls = cn(
  "w-full rounded-xl border px-3 py-2 text-xs outline-none transition-colors",
  "focus:border-mota-500"
)

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{label}</label>
      <div style={{ ["--tw-border-color" as string]: "var(--border-color)", background: "var(--bg-card)", color: "var(--text-primary)" }}>
        {children}
      </div>
    </div>
  )
}

function SaveButton({ saving }: { saving: boolean }) {
  return (
    <button
      type="submit"
      disabled={saving}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-mota-600 hover:bg-mota-700 disabled:opacity-50 transition-colors"
    >
      <Save size={13} />
      {saving ? "Salvando..." : "Salvar alterações"}
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:   { label: "Ativo",     cls: "bg-mota-500/20 text-mota-400"    },
    paused:   { label: "Pausado",   cls: "bg-yellow-500/20 text-yellow-400" },
    archived: { label: "Arquivado", cls: "bg-gray-500/20 text-gray-400"     },
  }
  const s = map[status] ?? { label: status, cls: "bg-gray-500/20 text-gray-400" }
  return (
    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", s.cls)}>
      {s.label}
    </span>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="space-y-3 w-full max-w-2xl p-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 rounded-xl animate-pulse"
            style={{ background: "var(--bg-card)" }} />
        ))}
      </div>
    </div>
  )
}

function ErrorState({ error, onBack }: { error: string | null; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <Bot size={32} style={{ color: "var(--text-muted)" }} />
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {error ?? "Agente não encontrado"}
      </p>
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-mota-600 text-white hover:bg-mota-700"
      >
        <ArrowLeft size={13} /> Voltar
      </button>
    </div>
  )
}
