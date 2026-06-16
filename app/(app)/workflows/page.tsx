"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { GitBranch, Search, Plus, Loader2, AlertCircle, RefreshCw } from "lucide-react"
import { PageHeader } from "@/components/ui/PageHeader"
import { EmptyState } from "@/components/ui/EmptyState"
import { WorkflowCard } from "@/components/workflows/WorkflowCard"
import { WorkflowModal } from "@/components/workflows/WorkflowModal"
import { WorkflowCreateModal } from "@/components/workflows/WorkflowCreateModal"
import { useCompany } from "@/components/providers/CompanyProvider"
import { cn } from "@/lib/utils"
import type { DBWorkflow } from "@/lib/workflow-types"
import { categoryLabel } from "@/lib/workflow-types"

const CATEGORY_FILTER_LABEL = "Todos"

export default function WorkflowsPage() {
  const { currentCompany } = useCompany()

  const [workflows,  setWorkflows]  = useState<DBWorkflow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [fetchErr,   setFetchErr]   = useState<string | null>(null)
  const [search,     setSearch]     = useState("")
  const [category,   setCategory]   = useState(CATEGORY_FILTER_LABEL)
  const [selected,   setSelected]   = useState<DBWorkflow | null>(null)
  const [creating,   setCreating]   = useState(false)
  const [editTarget, setEditTarget] = useState<DBWorkflow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFetchErr(null)
    try {
      const params = currentCompany ? `?company_id=${currentCompany.slug}` : ""
      const res  = await fetch(`/api/workflows${params}`)
      const json = await res.json() as { workflows?: DBWorkflow[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar")
      setWorkflows(json.workflows ?? [])
    } catch (e: unknown) {
      setFetchErr(e instanceof Error ? e.message : "Erro desconhecido")
    } finally {
      setLoading(false)
    }
  }, [currentCompany])

  useEffect(() => { void load() }, [load])

  // Categorias únicas para o filtro
  const categories = [
    CATEGORY_FILTER_LABEL,
    ...Array.from(new Set(
      workflows.map((w) => categoryLabel(w.category ?? w.area))
    )).sort(),
  ]

  const filtered = workflows.filter((w) => {
    const cat  = categoryLabel(w.category ?? w.area)
    const matchCat    = category === CATEGORY_FILTER_LABEL || cat === category
    const matchSearch = !search ||
      w.name.toLowerCase().includes(search.toLowerCase()) ||
      (w.description ?? "").toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  const activeCount = workflows.filter((w) => w.status === "active").length
  const totalRuns   = workflows.reduce((s, w) => s + (w.run_count ?? 0), 0)

  function handleCreated(wf: DBWorkflow) {
    setWorkflows((prev) => [wf, ...prev])
    setCreating(false)
  }

  function handleUpdated(wf: DBWorkflow) {
    setWorkflows((prev) => prev.map((w) => w.id === wf.id ? wf : w))
    setEditTarget(null)
  }

  function handleDeleted(id: string) {
    setWorkflows((prev) => prev.filter((w) => w.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Workflows"
        subtitle={
          loading
            ? "Carregando..."
            : `${workflows.length} workflow${workflows.length !== 1 ? "s" : ""} · ${activeCount} ativo${activeCount !== 1 ? "s" : ""}`
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-screen-xl mx-auto space-y-5">

          {/* Stats */}
          {!loading && !fetchErr && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total",           value: workflows.length,  color: "#16a34a" },
                { label: "Ativos",          value: activeCount,        color: "#3b82f6" },
                { label: "Categorias",      value: categories.length - 1, color: "#8b5cf6" },
                { label: "Execuções",       value: `${totalRuns}×`,   color: "#f97316" },
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
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Busca */}
            <div
              className="flex items-center gap-2 rounded-xl px-3 h-9 border flex-1 max-w-64"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
            >
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar workflows..."
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]"
                style={{ color: "var(--text-primary)" }}
              />
            </div>

            {/* Filtro de categoria */}
            {categories.length > 1 && (
              <div
                className="flex items-center gap-1 p-1 rounded-xl border flex-wrap"
                style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
              >
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                      category === c ? "bg-mota-600 text-white" : "hover:bg-[var(--bg-hover)]"
                    )}
                    style={{ color: category === c ? undefined : "var(--text-secondary)" }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}

            {/* Botão criar */}
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-mota-600 hover:bg-mota-700 transition-colors ml-auto"
            >
              <Plus size={13} /> Novo workflow
            </button>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          )}

          {/* Erro */}
          {fetchErr && (
            <div className="flex flex-col items-center gap-3 py-12">
              <AlertCircle size={24} className="text-red-400" />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{fetchErr}</p>
              <button
                onClick={() => void load()}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]"
                style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
              >
                <RefreshCw size={12} /> Tentar novamente
              </button>
            </div>
          )}

          {/* Grid */}
          {!loading && !fetchErr && (
            <AnimatePresence mode="popLayout">
              {filtered.length === 0 ? (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  {search ? (
                    <EmptyState
                      icon={Search}
                      title="Nenhum workflow encontrado"
                      description="Tente outro termo de busca ou ajuste os filtros."
                    />
                  ) : (
                    <EmptyState
                      icon={GitBranch}
                      title="Nenhum workflow criado ainda"
                      description="Automatize tarefas repetitivas encadeando ações em fluxos disparados por eventos ou agendamentos."
                      action={{
                        label:   "Criar primeiro workflow",
                        icon:    Plus,
                        onClick: () => setCreating(true),
                      }}
                    />
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="grid"
                  className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                >
                  {filtered.map((w, i) => (
                    <WorkflowCard
                      key={w.id}
                      workflow={w}
                      index={i}
                      onExecute={setSelected}
                      onEdit={setEditTarget}
                      onDelete={handleDeleted}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          )}

        </div>
      </div>

      {/* Modal de execução */}
      <WorkflowModal
        workflow={selected}
        onClose={() => setSelected(null)}
      />

      {/* Modal de criação */}
      <WorkflowCreateModal
        open={creating || !!editTarget}
        workflow={editTarget}
        onClose={() => { setCreating(false); setEditTarget(null) }}
        onSaved={(wf) => editTarget ? handleUpdated(wf) : handleCreated(wf)}
      />
    </div>
  )
}
