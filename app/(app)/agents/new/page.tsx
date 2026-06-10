"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Bot, Save, AlertCircle, FileText, X, Loader2 } from "lucide-react"
import { useCompany } from "@/components/providers/CompanyProvider"
import { cn } from "@/lib/utils"

const ALLOWED_EXTS = [".md", ".txt", ".csv", ".json"]

const inputCls = [
  "w-full rounded-xl border px-3 py-2 text-xs outline-none transition-colors",
  "focus:border-mota-500",
  "bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]",
].join(" ")

export default function NewAgentPage() {
  const router = useRouter()
  const { currentCompany } = useCompany()

  const [form, setForm] = useState({
    name:             "",
    short_name:       "",
    slug:             "",
    description:      "",
    role_description: "",
    category:         "",
    icon:             "Bot",
    color:            "#6366f1",
    bg_color:         "rgba(99,102,241,0.12)",
    provider:         "anthropic",
    model_id:         "claude-sonnet-4-6",
    temperature:      0.7,
    max_tokens:       4000,
    system_prompt:    "",
  })

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // Arquivos de memória escolhidos antes da criação (enviados após criar o agente)
  const [memFiles, setMemFiles] = useState<File[]>([])
  const [progress, setProgress] = useState<string | null>(null)

  const addMemFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    const valid = picked.filter((f) => {
      const dot = f.name.lastIndexOf(".")
      const ext = dot !== -1 ? f.name.slice(dot).toLowerCase() : ""
      return ALLOWED_EXTS.includes(ext) && f.size <= 20 * 1024 * 1024
    })
    setMemFiles((prev) => [...prev, ...valid])
    e.target.value = ""
  }

  const removeMemFile = (idx: number) =>
    setMemFiles((prev) => prev.filter((_, i) => i !== idx))

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const val = k === "temperature" || k === "max_tokens" ? Number(e.target.value) : e.target.value
      setForm((f) => {
        const next = { ...f, [k]: val }
        // Auto-fill slug from name
        if (k === "name") {
          next.slug = (e.target.value as string)
            .toLowerCase()
            .trim()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "")
          if (!f.short_name || f.short_name === f.name) {
            next.short_name = e.target.value as string
          }
        }
        return next
      })
    }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError("Nome é obrigatório."); return }

    setSaving(true)
    setError(null)

    try {
      const res = await fetch("/api/agents", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          company_id: currentCompany?.slug ?? null,
        }),
      })

      if (res.status === 401) { setError("Sessão expirada. Faça login novamente."); return }
      if (res.status === 403) {
        setError("Sem permissão. Apenas administradores globais podem criar agentes.")
        return
      }

      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Erro ao criar agente."); return }

      // Envia e indexa os arquivos de memória escolhidos
      if (memFiles.length > 0) {
        for (let i = 0; i < memFiles.length; i++) {
          const file = memFiles[i]
          setProgress(`Enviando memória (${i + 1}/${memFiles.length}): ${file.name}`)
          try {
            const fd = new FormData()
            fd.append("file", file)
            const upRes = await fetch(`/api/agents/${data.id}/files/upload`, { method: "POST", body: fd })
            if (upRes.ok) {
              const uploaded = await upRes.json() as { id: string; extracted_text?: string | null }
              if (uploaded.extracted_text) {
                setProgress(`Indexando memória (${i + 1}/${memFiles.length}): ${file.name}`)
                await fetch("/api/rag/index", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ source_type: "agent_file", source_id: uploaded.id }),
                }).catch(() => null)
              }
            }
          } catch { /* segue para o próximo arquivo */ }
        }
      }

      router.push(`/agents/${data.id}`)
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setSaving(false)
      setProgress(null)
    }
  }

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
          style={{ background: form.bg_color }}
        >
          <Bot size={16} style={{ color: form.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            {form.name || "Novo agente"}
          </h1>
          {currentCompany && (
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Será vinculado a: {currentCompany.name}
            </p>
          )}
        </div>
      </header>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-6">
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-6">

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* ── Seção: Identidade ── */}
          <Section title="Identidade">
            <Row label="Nome *">
              <input className={inputCls} value={form.name} onChange={set("name")} required
                placeholder="ex: Agente de Marketing" autoFocus />
            </Row>
            <Row label="Nome curto">
              <input className={inputCls} value={form.short_name} onChange={set("short_name")}
                placeholder="ex: Marketing" />
            </Row>
            <Row label="Slug (URL)">
              <input className={inputCls} value={form.slug} onChange={set("slug")}
                placeholder="ex: marketing" pattern="[a-z0-9-]+" />
            </Row>
            <Row label="Categoria">
              <input className={inputCls} value={form.category} onChange={set("category")}
                placeholder="ex: Marketing, Suporte, Vendas" />
            </Row>
          </Section>

          {/* ── Seção: Descrição / Papel ── */}
          <Section title="Descrição">
            <Row label="Descrição curta">
              <textarea className={inputCls} rows={2} value={form.description} onChange={set("description")}
                placeholder="Uma linha descrevendo o que este agente faz." />
            </Row>
            <Row label="Papel (system prompt base)">
              <textarea className={inputCls} rows={5} value={form.role_description} onChange={set("role_description")}
                placeholder="Descreva o papel, tom, restrições e comportamento esperado deste agente..." />
            </Row>
          </Section>

          {/* ── Seção: Visual ── */}
          <Section title="Visual">
            <Row label="Ícone (nome Lucide)">
              <input className={inputCls} value={form.icon} onChange={set("icon")}
                placeholder="Bot" />
            </Row>
            <div className="grid grid-cols-2 gap-4">
              <Row label="Cor primária">
                <div className="flex items-center gap-2">
                  <input type="color" value={form.color} onChange={set("color")}
                    className="w-8 h-8 rounded cursor-pointer border-0 p-0 shrink-0" />
                  <input className={cn(inputCls, "flex-1")} value={form.color} onChange={set("color")} />
                </div>
              </Row>
              <Row label="Cor de fundo">
                <input className={inputCls} value={form.bg_color} onChange={set("bg_color")}
                  placeholder="rgba(99,102,241,0.12)" />
              </Row>
            </div>
          </Section>

          {/* ── Seção: Modelo ── */}
          <Section title="Configuração de modelo">
            <Row label="Provedor">
              <select className={inputCls} value={form.provider} onChange={set("provider")}>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </Row>
            <Row label="Model ID">
              <input className={inputCls} value={form.model_id} onChange={set("model_id")}
                placeholder="claude-sonnet-4-6" />
            </Row>
            <Row label={`Temperatura (${form.temperature})`}>
              <input type="range" min={0} max={1} step={0.05}
                value={form.temperature} onChange={set("temperature")}
                className="w-full accent-mota-600" />
            </Row>
            <Row label="Max tokens">
              <input type="number" className={inputCls} value={form.max_tokens} onChange={set("max_tokens")}
                min={256} max={32000} step={256} />
            </Row>
            <Row label="System prompt (opcional — gerado automaticamente se vazio)">
              <textarea className={inputCls} rows={4} value={form.system_prompt} onChange={set("system_prompt")}
                placeholder="Deixe em branco para gerar a partir do nome e descrição." />
            </Row>
          </Section>

          {/* ── Seção: Memória (arquivos) ── */}
          <Section title="Memória (arquivos de conhecimento)">
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              O agente absorve estes arquivos e os usa automaticamente em toda conversa.
              São indexados ao criar o agente.
            </p>
            <label
              className={cn(
                "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 cursor-pointer transition-colors",
                saving ? "opacity-50 pointer-events-none" : "hover:border-mota-500",
              )}
              style={{ borderColor: "var(--border-color)" }}
            >
              <FileText size={20} style={{ color: "var(--text-muted)" }} />
              <p className="mt-2 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                Clique para adicionar arquivos
              </p>
              <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                .md, .txt, .csv, .json · máx 20 MB cada
              </p>
              <input type="file" accept=".md,.txt,.csv,.json" multiple className="hidden"
                onChange={addMemFiles} disabled={saving} />
            </label>

            {memFiles.length > 0 && (
              <div className="space-y-2">
                {memFiles.map((f, idx) => (
                  <div key={`${f.name}-${idx}`}
                    className="flex items-center gap-3 rounded-xl border px-3 py-2"
                    style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
                    <FileText size={13} style={{ color: "var(--text-muted)" }} />
                    <span className="flex-1 min-w-0 truncate text-xs" style={{ color: "var(--text-primary)" }}>
                      {f.name}
                    </span>
                    <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
                      {(f.size / 1024).toFixed(1)} KB
                    </span>
                    {!saving && (
                      <button type="button" onClick={() => removeMemFile(idx)}
                        className="p-1 rounded-lg hover:bg-red-500/10 text-red-400 transition-colors">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Progresso de upload */}
          {progress && (
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <Loader2 size={13} className="animate-spin" />
              {progress}
            </div>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3 pb-4">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-mota-600 hover:bg-mota-700 disabled:opacity-50 transition-colors"
            >
              <Save size={14} />
              {saving
                ? (memFiles.length > 0 ? "Criando e enviando memória..." : "Criando agente...")
                : "Criar agente"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/agents")}
              className="px-4 py-2.5 rounded-xl text-xs font-medium border transition-colors hover:bg-[var(--bg-hover)]"
              style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
            >
              Cancelar
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl border p-5 space-y-4"
      style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
    >
      <h2 className="text-xs font-semibold tracking-wide uppercase"
        style={{ color: "var(--text-muted)" }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </label>
      {children}
    </div>
  )
}
