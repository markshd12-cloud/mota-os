"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  FolderOpen, Plus, Search, X, Loader2,
  ChevronDown, Archive,
} from "lucide-react"
import { PageHeader }  from "@/components/ui/PageHeader"
import { EmptyState }  from "@/components/ui/EmptyState"
import { ProjectCard } from "@/components/projects/ProjectCard"
import { useCompany }  from "@/components/providers/CompanyProvider"
import type { ApiProject } from "@/lib/project-helpers"
import type { Project }    from "@/lib/mocks/projects"
import { cn } from "@/lib/utils"

// ─── Mapeamento empresa → display ────────────────────────────────────────────

const COMPANY_META: Record<string, { name: string; color: string }> = {
  cppem:   { name: "CPPEM Concursos", color: "#16a34a" },
  unicive:  { name: "Unicive",         color: "#3b82f6" },
  colegio:  { name: "Colégio CPPEM",   color: "#f59e0b" },
  everton:  { name: "Everton Mota",    color: "#ec4899" },
  grupo:    { name: "Grupo Mota",      color: "#06b6d4" },
}

const PRIORITY_LABELS: Record<string, string> = {
  low: "Baixa", medium: "Média", high: "Alta", urgent: "Urgente",
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min  = Math.floor(diff / 60_000)
  if (min < 60)  return `há ${min}min`
  const hr = Math.floor(min / 60)
  if (hr < 24)   return `há ${hr}h`
  const dy = Math.floor(hr / 24)
  if (dy === 1)  return "ontem"
  return `${dy} dias`
}

function fmtDate(d: string | null): string {
  if (!d) return ""
  const [y, m, day] = d.split("-")
  return `${day}/${m}/${y}`
}

function toUiProject(p: ApiProject): Project {
  const co = COMPANY_META[p.company_id] ?? { name: p.company_id, color: "#6366f1" }
  return {
    id:               p.id,
    title:            p.name,
    description:      p.description,
    company:          co.name,
    companyColor:     co.color,
    responsible:      "—",
    responsibleAvatar:"?",
    status:           p.status as Project["status"],
    sessionsCount:    p.sessions_count,
    tasksOpen:        p.tasks_open,
    tasksTotal:       p.tasks_total,
    lastUpdated:      fmtRelative(p.updated_at),
    tags:             p.tags,
    startDate:        fmtDate(p.start_date),
    endDate:          p.due_date ? fmtDate(p.due_date) : undefined,
    progress:         p.progress,
    objective:        p.objectives ?? p.description,
    budget:           p.budget != null
      ? `R$ ${Number(p.budget).toLocaleString("pt-BR")}`
      : undefined,
    highlights:       p.highlights,
  }
}

// ─── Filtros de status ────────────────────────────────────────────────────────

type StatusFilter = "all" | "active" | "planning" | "paused" | "completed"

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "Todos",        value: "all"       },
  { label: "Ativos",       value: "active"    },
  { label: "Planejamento", value: "planning"  },
  { label: "Pausados",     value: "paused"    },
  { label: "Concluídos",   value: "completed" },
]

// ─── Formulário de criação ────────────────────────────────────────────────────

interface CreateForm {
  name:        string
  description: string
  status:      string
  priority:    string
  start_date:  string
  due_date:    string
  budget:      string
  objectives:  string
  tags:        string
}

const EMPTY_FORM: CreateForm = {
  name: "", description: "", status: "planning", priority: "medium",
  start_date: "", due_date: "", budget: "", objectives: "", tags: "",
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ProjectsClient() {
  const router = useRouter()
  const { currentCompany } = useCompany()
  const companyId = currentCompany?.slug

  const [projects, setProjects]         = useState<ApiProject[]>([])
  const [loading, setLoading]           = useState(false)
  const [filter, setFilter]             = useState<StatusFilter>("all")
  const [search, setSearch]             = useState("")
  const [creating, setCreating]         = useState(false)
  const [form, setForm]                 = useState<CreateForm>(EMPTY_FORM)
  const [saving, setSaving]             = useState(false)
  const [formError, setFormError]       = useState("")
  const [archivingId, setArchivingId]   = useState<string | null>(null)

  const loadProjects = useCallback(async () => {
    if (!companyId) { setProjects([]); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ company_id: companyId })
      if (filter !== "all") params.set("status", filter)
      const res = await fetch(`/api/projects?${params}`)
      if (res.ok) setProjects(await res.json() as ApiProject[])
    } finally {
      setLoading(false)
    }
  }, [companyId, filter])

  useEffect(() => { void loadProjects() }, [loadProjects])

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.description.toLowerCase().includes(search.toLowerCase())
  )

  function openDetail(p: Project) {
    router.push(`/projects/${p.id}`)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!companyId) return
    setFormError("")
    setSaving(true)
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id:  companyId,
          name:        form.name,
          description: form.description,
          status:      form.status,
          priority:    form.priority,
          start_date:  form.start_date || undefined,
          due_date:    form.due_date   || undefined,
          budget:      form.budget ? Number(form.budget) : undefined,
          objectives:  form.objectives || undefined,
          tags:        form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        }),
      })
      const json = await res.json() as ApiProject
      if (!res.ok) {
        setFormError((json as unknown as { error: string }).error ?? "Erro ao criar projeto")
        return
      }
      setCreating(false)
      setForm(EMPTY_FORM)
      // Adiciona ao state imediatamente (não depende de loadProjects ter sucesso)
      setProjects((prev) => [json, ...prev])
      // Reload em background para sincronizar eventual divergência
      void loadProjects()
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive(id: string) {
    setArchivingId(id)
    try {
      const res = await fetch("/api/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (res.ok) void loadProjects()
    } finally {
      setArchivingId(null)
    }
  }

  const uiProjects = filtered.map(toUiProject)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Projetos"
        subtitle={
          loading
            ? "Carregando..."
            : `${projects.length} projetos · ${projects.filter((p) => p.status === "active").length} ativos`
        }
        actions={
          <button
            onClick={() => { setCreating(true); setForm(EMPTY_FORM); setFormError("") }}
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors"
          >
            <Plus size={13} /> Novo projeto
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-screen-xl mx-auto space-y-5">

          {/* Filtros */}
          <div className="flex items-center gap-3 flex-wrap">
            <div
              className="flex items-center gap-2 rounded-xl px-3 h-9 border flex-1 max-w-64"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
            >
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar projetos..."
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]"
                style={{ color: "var(--text-primary)" }}
              />
            </div>

            <div
              className="flex items-center gap-1 p-1 rounded-xl border"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
            >
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                    filter === f.value ? "bg-mota-600 text-white" : "hover:bg-[var(--bg-hover)]"
                  )}
                  style={{ color: filter === f.value ? undefined : "var(--text-secondary)" }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total",           value: projects.length,                                                  color: "#16a34a" },
              { label: "Ativos",          value: projects.filter((p) => p.status === "active").length,             color: "#3b82f6" },
              { label: "Concluídos",      value: projects.filter((p) => p.status === "completed").length,          color: "#8b5cf6" },
              { label: "Tarefas abertas", value: projects.reduce((a, p) => a + p.tasks_open, 0),                   color: "#f97316" },
            ].map((stat) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl p-4 border"
                style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
              >
                <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{stat.label}</p>
              </motion.div>
            ))}
          </div>

          {/* Grid de projetos */}
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-2">
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>Carregando projetos...</span>
            </div>
          ) : uiProjects.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="Nenhum projeto ainda"
              description="Organize seu trabalho em projetos e conecte conversas, fontes e tarefas a eles."
              action={{
                label:   "Criar primeiro projeto",
                icon:    Plus,
                onClick: () => { setCreating(true); setForm(EMPTY_FORM); setFormError("") },
              }}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {uiProjects.map((p, i) => (
                <div key={p.id} className="relative group/card">
                  <ProjectCard project={p} index={i} onOpen={openDetail} />
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleArchive(p.id) }}
                    disabled={archivingId === p.id}
                    className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center rounded-lg opacity-0 group-hover/card:opacity-100 transition-opacity hover:bg-[var(--bg-hover)]"
                    style={{ color: "var(--text-muted)" }}
                    title="Arquivar projeto"
                  >
                    {archivingId === p.id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Archive size={12} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal de criação */}
      <AnimatePresence>
        {creating && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setCreating(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div
                className="w-full max-w-xl max-h-[88vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden pointer-events-auto"
                style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div
                  className="flex items-center justify-between px-6 py-4 border-b shrink-0"
                  style={{ borderColor: "var(--border-color)" }}
                >
                  <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    Novo projeto
                  </h2>
                  <button
                    onClick={() => setCreating(false)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--bg-hover)]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Form */}
                <form onSubmit={handleCreate} className="flex-1 overflow-y-auto p-6 space-y-4">
                  <Field label="Nome *">
                    <input
                      required
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Nome do projeto"
                      className="w-full text-xs px-3 py-2 rounded-lg border outline-none focus:ring-1 focus:ring-mota-500"
                      style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                    />
                  </Field>

                  <Field label="Descrição">
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="Descreva o projeto..."
                      rows={2}
                      className="w-full text-xs px-3 py-2 rounded-lg border outline-none focus:ring-1 focus:ring-mota-500 resize-none"
                      style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Status">
                      <SelectField
                        value={form.status}
                        onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                        options={[
                          { value: "planning",  label: "Planejamento" },
                          { value: "active",    label: "Ativo" },
                          { value: "paused",    label: "Pausado" },
                          { value: "completed", label: "Concluído" },
                        ]}
                      />
                    </Field>
                    <Field label="Prioridade">
                      <SelectField
                        value={form.priority}
                        onChange={(v) => setForm((f) => ({ ...f, priority: v }))}
                        options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Data de início">
                      <input
                        type="date"
                        value={form.start_date}
                        onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                        className="w-full text-xs px-3 py-2 rounded-lg border outline-none focus:ring-1 focus:ring-mota-500"
                        style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                      />
                    </Field>
                    <Field label="Data de entrega">
                      <input
                        type="date"
                        value={form.due_date}
                        onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                        className="w-full text-xs px-3 py-2 rounded-lg border outline-none focus:ring-1 focus:ring-mota-500"
                        style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                      />
                    </Field>
                  </div>

                  <Field label="Budget (R$)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.budget}
                      onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))}
                      placeholder="0,00"
                      className="w-full text-xs px-3 py-2 rounded-lg border outline-none focus:ring-1 focus:ring-mota-500"
                      style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                    />
                  </Field>

                  <Field label="Objetivo">
                    <textarea
                      value={form.objectives}
                      onChange={(e) => setForm((f) => ({ ...f, objectives: e.target.value }))}
                      placeholder="Qual o objetivo principal deste projeto?"
                      rows={2}
                      className="w-full text-xs px-3 py-2 rounded-lg border outline-none focus:ring-1 focus:ring-mota-500 resize-none"
                      style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                    />
                  </Field>

                  <Field label="Tags (separadas por vírgula)">
                    <input
                      value={form.tags}
                      onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                      placeholder="Meta Ads, Leads, Urgente"
                      className="w-full text-xs px-3 py-2 rounded-lg border outline-none focus:ring-1 focus:ring-mota-500"
                      style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                    />
                  </Field>

                  {formError && (
                    <p className="text-xs text-red-500">{formError}</p>
                  )}
                </form>

                {/* Footer */}
                <div
                  className="flex items-center justify-end gap-3 px-6 py-4 border-t shrink-0"
                  style={{ borderColor: "var(--border-color)" }}
                >
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="text-xs px-4 py-2 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={saving || !form.name.trim()}
                    className="flex items-center gap-2 text-xs px-4 py-2 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors disabled:opacity-50"
                  >
                    {saving && <Loader2 size={12} className="animate-spin" />}
                    Criar projeto
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Helpers de formulário ────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>{label}</label>
      {children}
    </div>
  )
}

function SelectField({
  value, onChange, options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-xs px-3 py-2 pr-7 rounded-lg border outline-none focus:ring-1 focus:ring-mota-500 appearance-none"
        style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
    </div>
  )
}
