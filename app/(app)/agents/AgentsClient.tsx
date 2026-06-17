"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Bot, Search, X, Plus, Archive } from "lucide-react"
import { useRouter } from "next/navigation"
import { PageHeader } from "@/components/ui/PageHeader"
import { EmptyState } from "@/components/ui/EmptyState"
import { type AgentWithConfig } from "@/hooks/useAgents"
import { cn } from "@/lib/utils"

const statusFilters = [
  { label: "Todos",      value: "all"      },
  { label: "Ativos",     value: "active"   },
  { label: "Pausados",   value: "paused"   },
  { label: "Arquivados", value: "archived" },
] as const

type StatusFilter = (typeof statusFilters)[number]["value"]

interface AgentsClientProps {
  agents:   AgentWithConfig[]
  loading:  boolean
  error:    string | null
  onReload: () => void
}

export function AgentsClient({ agents, loading, error, onReload }: AgentsClientProps) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")

  const filtered = agents.filter((a) => {
    const matchStatus =
      status === "all" ||
      a.status === status ||
      (status === "archived" && a.status === "archived")
    const matchSearch =
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const stats = [
    { label: "Total",     value: agents.length,                                   color: "#6366f1" },
    { label: "Ativos",    value: agents.filter(a => a.status === "active").length, color: "#16a34a" },
    { label: "Pausados",  value: agents.filter(a => a.status === "paused").length, color: "#f59e0b" },
    { label: "Arquivos",  value: agents.reduce((s, a) => s + a.filesCount, 0),     color: "#3b82f6" },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Agentes"
        subtitle="Assistentes de IA especializados do Grupo Mota"
        actions={
          <button
            onClick={() => router.push("/agents/new")}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-mota-600 hover:bg-mota-700 transition-colors"
          >
            <Plus size={13} />
            Novo agente
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-screen-xl mx-auto space-y-5">

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
                placeholder="Buscar agentes..."
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]"
                style={{ color: "var(--text-primary)" }}
              />
              {search && (
                <button onClick={() => setSearch("")} style={{ color: "var(--text-muted)" }}>
                  <X size={12} />
                </button>
              )}
            </div>
            <div
              className="flex items-center gap-1 p-1 rounded-xl border"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
            >
              {statusFilters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setStatus(f.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                    status === f.value ? "bg-mota-600 text-white" : "hover:bg-[var(--bg-hover)]"
                  )}
                  style={{ color: status === f.value ? undefined : "var(--text-secondary)" }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stats.map((s) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl p-4 border"
                style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
              >
                <p className="text-2xl font-bold" style={{ color: s.color }}>
                  {loading ? "—" : s.value}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
              </motion.div>
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl p-4 border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
              {error} —{" "}
              <button className="underline" onClick={onReload}>tentar novamente</button>
            </div>
          )}

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl border h-64 animate-pulse"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            search ? (
              <EmptyState
                icon={Search}
                title="Nenhum agente encontrado"
                description={`Nenhum resultado para "${search}". Tente outro termo de busca.`}
              />
            ) : (
              <EmptyState
                icon={Bot}
                title="Nenhum agente ainda"
                description="Crie agentes de IA especializados para responder seu time com contexto e instruções próprias."
                action={{
                  label:   "Criar primeiro agente",
                  icon:    Plus,
                  onClick: () => router.push("/agents/new"),
                }}
              />
            )
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((a, i) => (
                <AgentCard key={a.dbId} agent={a} index={i} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Card inline (usa AgentWithConfig diretamente) ────────────────────────────

function AgentCard({ agent: a, index }: { agent: AgentWithConfig; index: number }) {
  const router = useRouter()

  const statusLabel = a.status === "active" ? "Ativo"
    : a.status === "paused"   ? "Pausado"
    : a.status === "archived" ? "Arquivado"
    : a.status

  const statusColor = a.status === "active"
    ? { bg: "bg-mota-500/20",  text: "text-mota-400",   dot: "bg-mota-500 animate-pulse" }
    : a.status === "archived"
    ? { bg: "bg-gray-500/20",  text: "text-gray-400",   dot: "bg-gray-500" }
    : { bg: "bg-yellow-500/20", text: "text-yellow-400", dot: "bg-yellow-500" }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      whileHover={{ y: -3, transition: { duration: 0.15 } }}
      className="rounded-2xl border flex flex-col overflow-hidden cursor-pointer group"
      style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      onClick={() => router.push(`/agents/${a.dbId}`)}
    >
      {/* Top color accent */}
      <div
        className="h-24 flex items-center justify-center shrink-0 relative overflow-hidden"
        style={{ background: a.bg }}
      >
        <div
          className="absolute inset-0 opacity-20"
          style={{ background: `radial-gradient(circle at 70% 30%, ${a.color}, transparent 60%)` }}
        />
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center border-2 relative z-10"
          style={{ background: `${a.color}20`, borderColor: `${a.color}40` }}
        >
          <a.icon size={26} style={{ color: a.color }} />
        </div>

        {/* Status pill */}
        <div className={cn(
          "absolute top-3 right-3 flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full",
          statusColor.bg, statusColor.text
        )}>
          <span className={cn("w-1.5 h-1.5 rounded-full", statusColor.dot)} />
          {statusLabel}
        </div>

        {/* Archive button (admin) */}
        {a.status !== "archived" && (
          <button
            className="absolute top-3 left-3 w-6 h-6 flex items-center justify-center rounded-lg bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Arquivar"
            onClick={async (e) => {
              e.stopPropagation()
              await fetch(`/api/agents/${a.dbId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "archived" }),
              })
              router.refresh()
            }}
          >
            <Archive size={11} className="text-white" />
          </button>
        )}
      </div>

      <div className="p-5 flex flex-col gap-3 flex-1">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{a.name}</h3>
            {a.category && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border shrink-0"
                style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}>
                {a.category}
              </span>
            )}
          </div>
          <p className="text-xs mt-1 leading-relaxed line-clamp-2" style={{ color: "var(--text-secondary)" }}>
            {a.longDescription || a.description}
          </p>
        </div>

        {/* Capabilities */}
        {a.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {a.capabilities.slice(0, 3).map((cap) => (
              <span
                key={cap}
                className="text-[10px] px-2 py-0.5 rounded-full font-medium border"
                style={{ background: `${a.color}10`, color: a.color, borderColor: `${a.color}25` }}
              >
                {cap}
              </span>
            ))}
            {a.capabilities.length > 3 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: "var(--text-muted)" }}>
                +{a.capabilities.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Meta */}
        <div className="flex items-center gap-3 text-[11px] mt-auto" style={{ color: "var(--text-muted)" }}>
          <span>{a.provider} · {a.modelId.split("-").slice(0, 2).join("-")}</span>
          {a.filesCount > 0 && (
            <>
              <span className="w-px h-3" style={{ background: "var(--border-color)" }} />
              <span>{a.filesCount} arquivo{a.filesCount !== 1 ? "s" : ""}</span>
            </>
          )}
          {a.companies.length > 0 && (
            <>
              <span className="w-px h-3" style={{ background: "var(--border-color)" }} />
              <span>{a.companies.length} empresa{a.companies.length !== 1 ? "s" : ""}</span>
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}
