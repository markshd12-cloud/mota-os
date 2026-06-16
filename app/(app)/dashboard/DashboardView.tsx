"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  MessageSquare, GitBranch, Bot, Activity,
  AlertTriangle, Eye, Database, Layers,
  FolderOpen, Zap, TrendingUp, Clock,
  BarChart2, RefreshCw, Sparkles, CheckCircle2,
  XCircle, AlertCircle,
} from "lucide-react"
import Link from "next/link"
import { useCompany }       from "@/components/providers/CompanyProvider"
import { useRouter }        from "next/navigation"
import { PageHeader }       from "@/components/ui/PageHeader"
import { ShieldAlert }      from "lucide-react"
import { MetricCard }       from "@/components/dashboard/MetricCard"
import { DashboardCard }    from "@/components/dashboard/DashboardCard"
import { AgentBarChart }    from "@/components/dashboard/AgentBarChart"
import { WeeklyActivityChart }        from "@/components/dashboard/WeeklyActivityChart"
import { SalesRevenueChart }          from "@/components/dashboard/SalesRevenueChart"
import { SalesByCompanyChart }        from "@/components/dashboard/SalesByCompanyChart"
import { SalesPaymentStatusChart }    from "@/components/dashboard/SalesPaymentStatusChart"
import { SalesMonthlyChart, SalesTicketChart } from "@/components/dashboard/SalesMonthlyChart"
import { SalesMappedChart }           from "@/components/dashboard/SalesMappedChart"

// ─── Types ────────────────────────────────────────────────────────────────────

type Period      = "today" | "yesterday" | "7d" | "30d" | "month_to_date"
type SalesPeriod = "today" | "yesterday" | "7d" | "30d" | "month" | "semester" | "year" | "custom"

const CHILD_COMPANIES_FILTER = [
  { slug: "cppem",   label: "CPPEM" },
  { slug: "unicive", label: "Unicive" },
  { slug: "colegio", label: "Colégio" },
  { slug: "everton", label: "Everton" },
]

const SALES_PERIOD_LABELS: Record<SalesPeriod, string> = {
  today:     "Hoje",
  yesterday: "Ontem",
  "7d":      "7 dias",
  "30d":     "30 dias",
  month:     "Mês atual",
  semester:  "Semestre",
  year:      "Ano",
  custom:    "Período",
}

interface SalesKpis {
  gross_revenue:  number
  net_revenue:    number
  total_sales:    number
  average_ticket: number
  total_refunds:  number
  paid_sales:     number
  pending_sales:  number
  canceled_sales: number
}

interface SalesDayPoint   { day: string; gross: number; net: number; count: number }
interface SalesCompanyBar { company_id: string; gross: number; net: number; count: number }
interface SalesStatusSlice { status: string; count: number; gross: number }
interface SalesTxnRow {
  id:                 string
  company_id:         string
  product_name:       string | null
  customer_name:      string | null
  gross_amount:       number | null
  net_amount:         number | null
  transaction_status: string | null
  payment_status:     string | null
  sale_date:          string
  source:             string
}
interface SalesComparison {
  current:   number
  previous:  number
  delta_pct: number | null
}

interface UnmappedStats { count: number; gross: number; net: number }

interface LastSync {
  status:        string
  processed:     number | null
  inserted:      number | null
  failed:        number | null
  started_at:    string
  finished_at:   string | null
  error_message: string | null
}

interface SalesData {
  period:                    string
  is_consolidated:           boolean
  kpis:                      SalesKpis
  active_filters:            Record<string, string | null>
  comparison: {
    gross_revenue:  SalesComparison
    net_revenue:    SalesComparison
    total_sales:    SalesComparison
    average_ticket: SalesComparison
    prev_period:    { start: string; end: string }
  }
  unmapped_stats:            UnmappedStats
  last_sync:                 LastSync | null
  revenue_by_day:            (SalesDayPoint & { avg_ticket: number })[]
  revenue_by_month:          { month: string; gross: number; net: number; count: number; avg_ticket: number }[]
  revenue_by_product:        { product: string; gross: number; net: number; count: number }[]
  revenue_by_company:        SalesCompanyBar[]
  revenue_by_payment_status: SalesStatusSlice[]
  revenue_by_source:         { source: string; count: number; gross: number; net: number }[]
  recent_transactions:       SalesTxnRow[]
}

interface Kpis {
  sessions_period:  number
  workflows_run:    number
  workflows_error:  number
  watchers_active:  number
  alerts_recent:    number
  sources_indexed:  number
  agents_active:    number
  rag_chunks:       number
  projects_active:  number
  projects_at_risk: number
}

interface ProjectRow {
  id:       string
  name:     string
  status:   string
  priority: string
  end_date: string | null
}

interface WorkflowRunRow {
  id:            string
  workflow_name: string | null
  workflow_slug: string | null
  status:        string
  created_at:    string
  error_message: string | null
}

interface AgentItem {
  id:        string
  name:      string
  shortName: string
  color:     string
  sessions:  number
}

interface SourceItem {
  id:     string
  name:   string
  type:   string
  status: string
}

interface ActivityItem {
  id:         string
  event_type: string
  action:     string
  detail:     string
  company_id: string | null
  created_at: string
}

interface Snapshot {
  id:           string
  snapshot_date: string
  period:       string
  ai_analysis:  string | null
  created_at:   string
}

interface OverviewData {
  company:         { slug: string; name: string; color: string } | null
  period:          string
  kpis:            Kpis
  projects:        ProjectRow[]
  projects_at_risk: ProjectRow[]
  workflow_runs:   WorkflowRunRow[]
  agents:          AgentItem[]
  sources: {
    breakdown: Record<string, number>
    items:     SourceItem[]
  }
  marketing: {
    has_data: boolean
    totals:   Record<string, number> | null
  }
  activity:        ActivityItem[]
  latest_snapshot: Snapshot | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = {
  today:          "Hoje",
  yesterday:      "Ontem",
  "7d":           "7 dias",
  "30d":          "30 dias",
  month_to_date:  "Mês atual",
}

const MARKETING_LABELS: Record<string, string> = {
  spend:           "Investimento",
  impressions:     "Impressões",
  clicks:          "Cliques",
  leads:           "Leads",
  sales:           "Vendas",
  revenue:         "Receita",
  cpc:             "CPC",
  cpl:             "CPL",
  cac:             "CAC",
  roi:             "ROI",
  conversion_rate: "Conv. Rate",
  sessions:        "Sessões (mkt)",
  users:           "Usuários",
  pageviews:       "Pageviews",
}

const CURRENCY_METRICS = new Set(["spend", "revenue", "cpc", "cpl", "cac"])
const PERCENT_METRICS  = new Set(["roi", "conversion_rate"])

function fmtMetric(key: string, val: number): string {
  if (CURRENCY_METRICS.has(key)) return `R$ ${val.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`
  if (PERCENT_METRICS.has(key))  return `${val.toFixed(1)}%`
  return val.toLocaleString("pt-BR", { maximumFractionDigits: 0 })
}

function fmtBrl(v: number): string {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `R$ ${(v / 1_000).toFixed(1)}k`
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return "agora"
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return d === 1 ? "ontem" : `há ${d}d`
}

function todayLabel(): string {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  })
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return "Bom dia"
  if (h < 18) return "Boa tarde"
  return "Boa noite"
}

const statusColor: Record<string, string> = {
  planning:   "#3b82f6",
  active:     "#16a34a",
  paused:     "#f59e0b",
  done:       "#16a34a",
  error:      "#ef4444",
  running:    "#3b82f6",
  ok:         "#16a34a",
  alert:      "#f59e0b",
}

const priorityBg: Record<string, string> = {
  urgent: "rgba(239,68,68,0.1)",
  high:   "rgba(245,158,11,0.1)",
  medium: "rgba(59,130,246,0.1)",
  low:    "rgba(148,163,184,0.1)",
}
const priorityText: Record<string, string> = {
  urgent: "#ef4444",
  high:   "#f59e0b",
  medium: "#3b82f6",
  low:    "#94a3b8",
}
const priorityLabel: Record<string, string> = {
  urgent: "Urgente",
  high:   "Alta",
  medium: "Média",
  low:    "Baixa",
}

const eventIcon: Record<string, typeof Activity> = {
  chat:     MessageSquare,
  workflow: GitBranch,
  source:   Database,
  watcher:  Eye,
  auth:     Bot,
  settings: FolderOpen,
  auto:     Zap,
  api:      Layers,
}

const container = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { staggerChildren: 0.04 } },
}
const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.35 } },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { currentCompany, loading: companyLoading, isAdmin, userRole } = useCompany()
  const router = useRouter()
  const [period,   setPeriod]   = useState<Period>("7d")
  const [data,     setData]     = useState<OverviewData | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError,   setAnalysisError]   = useState<string | null>(null)
  const [latestSnapshot,  setLatestSnapshot]  = useState<Snapshot | null>(null)

  // Sales state
  const [salesPeriod,        setSalesPeriod]        = useState<SalesPeriod>("30d")
  const [salesCompanyFilter, setSalesCompanyFilter] = useState<string | null>(null)
  const [salesData,          setSalesData]          = useState<SalesData | null>(null)
  const [salesLoading,       setSalesLoading]       = useState(false)
  const [salesError,         setSalesError]         = useState<string | null>(null)
  const [showManualSale,     setShowManualSale]     = useState(false)
  const [snapshotSaving,     setSnapshotSaving]     = useState(false)
  const [snapshotMsg,        setSnapshotMsg]        = useState<string | null>(null)

  // Conta Azul state
  const [caConnected,  setCaConnected]  = useState<boolean | null>(null)
  const [caSyncing,    setCaSyncing]    = useState(false)

  // Redirecionar não-admin após o role ser carregado
  useEffect(() => {
    if (!companyLoading && userRole !== null && !isAdmin) {
      router.replace("/chat")
    }
  }, [companyLoading, userRole, isAdmin, router])

  const fetchOverview = useCallback(async (company: string, p: Period) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/dashboard/overview?company_id=${company}&period=${p}`)
      if (!res.ok) throw new Error("Falha ao carregar dados do dashboard")
      const json = await res.json() as OverviewData
      setData(json)
      setLatestSnapshot(json.latest_snapshot)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro desconhecido")
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSales = useCallback(async (company: string, p: SalesPeriod, companyFilter?: string | null) => {
    setSalesLoading(true)
    setSalesError(null)
    try {
      const params = new URLSearchParams({ period: p })
      // Se há filtro de empresa específica, usa ele; caso contrário usa a empresa atual
      const effectiveCompany = companyFilter ?? company
      params.set("company_id", effectiveCompany)
      const res = await fetch(`/api/dashboard/sales?${params.toString()}`)
      if (!res.ok) throw new Error("Falha ao carregar dados de vendas")
      setSalesData(await res.json() as SalesData)
    } catch (e) {
      setSalesError(e instanceof Error ? e.message : "Erro desconhecido")
    } finally {
      setSalesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (currentCompany?.slug) void fetchOverview(currentCompany.slug, period)
  }, [currentCompany?.slug, period, fetchOverview])

  useEffect(() => {
    if (currentCompany?.slug) void fetchSales(currentCompany.slug, salesPeriod, salesCompanyFilter)
  }, [currentCompany?.slug, salesPeriod, salesCompanyFilter, fetchSales])

  useEffect(() => {
    fetch("/api/integrations/conta-azul/status")
      .then((r) => r.json() as Promise<{ connected: boolean; token_status: string }>)
      .then((s) => setCaConnected(s.connected && s.token_status === "valid"))
      .catch(() => setCaConnected(false))
  }, [])

  async function handleCaSync() {
    setCaSyncing(true)
    try {
      const today   = new Date()
      const todayStr = today.toISOString().slice(0, 10)
      const dayAgo  = (n: number) => {
        const d = new Date(today); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10)
      }
      const periodDates: Record<SalesPeriod, { start_date: string; end_date: string }> = {
        today:     { start_date: todayStr, end_date: todayStr },
        yesterday: { start_date: dayAgo(1), end_date: dayAgo(1) },
        "7d":      { start_date: dayAgo(6), end_date: todayStr },
        "30d":     { start_date: dayAgo(29), end_date: todayStr },
        month:     { start_date: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`, end_date: todayStr },
        semester:  { start_date: dayAgo(180), end_date: todayStr },
        year:      { start_date: `${today.getFullYear()}-01-01`, end_date: todayStr },
        custom:    { start_date: dayAgo(29), end_date: todayStr },
      }
      const { start_date, end_date } = periodDates[salesPeriod]
      await fetch("/api/integrations/conta-azul/sync", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ start_date, end_date }),
      })
      if (currentCompany?.slug) void fetchSales(currentCompany.slug, salesPeriod)
    } catch { /* silent */ } finally {
      setCaSyncing(false)
    }
  }

  async function createManualSnapshot() {
    if (!currentCompany?.slug) return
    setSnapshotSaving(true)
    setSnapshotMsg(null)
    try {
      const res = await fetch("/api/dashboard/snapshots", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ company_id: currentCompany.slug, period: "daily", triggered_by: "manual" }),
      })
      const json = await res.json() as { ok?: boolean; snapshot?: { id: string }; error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? "Erro ao criar snapshot")
      setSnapshotMsg("Snapshot criado com sucesso.")
    } catch (e) {
      setSnapshotMsg(e instanceof Error ? e.message : "Erro")
    } finally {
      setSnapshotSaving(false)
    }
  }

  async function generateAnalysis() {
    if (!currentCompany?.slug) return
    setAnalysisLoading(true)
    setAnalysisError(null)
    try {
      const res = await fetch("/api/dashboard/analyze", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ company_id: currentCompany.slug, period }),
      })
      const json = await res.json() as { ok?: boolean; analysis?: string; snapshot?: Snapshot; error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? "Erro na análise")
      if (json.snapshot) setLatestSnapshot(json.snapshot as Snapshot & { ai_analysis: string })
      // Rebuild snapshot with full analysis text
      setLatestSnapshot({
        id:           json.snapshot?.id ?? crypto.randomUUID(),
        snapshot_date: new Date().toISOString().slice(0, 10),
        period,
        ai_analysis:  json.analysis ?? null,
        created_at:   new Date().toISOString(),
      })
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "Erro desconhecido")
    } finally {
      setAnalysisLoading(false)
    }
  }

  const kpis      = data?.kpis
  const agents    = data?.agents    ?? []
  const marketing = data?.marketing ?? { has_data: false, totals: null }

  // Build weekly chart data from workflow runs (placeholder — 7 bars)
  const weeklyData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    d.setHours(0, 0, 0, 0)
    const prefix = d.toISOString().slice(0, 10)
    const DAY = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"]
    return {
      day:       i === 6 ? "Hoje" : DAY[d.getDay()],
      sessions:  0,
      workflows: (data?.workflow_runs ?? []).filter(r => r.created_at.startsWith(prefix)).length,
    }
  })

  // Bloqueio de acesso para não-admin (enquanto redireciona)
  if (!companyLoading && userRole !== null && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4" style={{ color: "var(--text-secondary)" }}>
        <ShieldAlert size={40} style={{ color: "#ef4444" }} />
        <div className="text-center">
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Acesso restrito a administradores.
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Redirecionando...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Dashboard"
        subtitle={todayLabel()}
        actions={
          <div className="flex items-center gap-1">
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className="text-[11px] px-2.5 py-1 rounded-lg border transition-all"
                style={{
                  borderColor: p === period ? "var(--mota-600)" : "var(--border-color)",
                  background:  p === period ? "rgba(22,163,74,0.12)" : "transparent",
                  color:       p === period ? "var(--mota-500)" : "var(--text-secondary)",
                  fontWeight:  p === period ? 600 : 400,
                }}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-screen-2xl mx-auto space-y-6">

          {/* Welcome */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center justify-between flex-wrap gap-3"
          >
            <div>
              <h2 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                {greeting()}, bom trabalho hoje.
              </h2>
              <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {companyLoading ? "Carregando empresa..." : `${currentCompany?.name ?? "—"} — visão ${PERIOD_LABELS[period].toLowerCase()}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => currentCompany && void fetchOverview(currentCompany.slug, period)}
                disabled={loading}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
                style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                Atualizar
              </button>
            </div>
          </motion.div>

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* KPI cards */}
          {(loading && !data) ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-xl border h-28 animate-pulse"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }} />
              ))}
            </div>
          ) : kpis && (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
              <MetricCard index={0} icon={MessageSquare} label="Sessões" value={String(kpis.sessions_period)}
                delta={PERIOD_LABELS[period]} deltaPositive sublabel="" color="#3b82f6" bg="rgba(59,130,246,0.1)" />
              <MetricCard index={1} icon={GitBranch} label="Workflows" value={String(kpis.workflows_run)}
                delta={kpis.workflows_error > 0 ? `${kpis.workflows_error} erros` : "sem erros"}
                deltaPositive={kpis.workflows_error === 0} sublabel="" color="#8b5cf6" bg="rgba(139,92,246,0.1)" />
              <MetricCard index={2} icon={Eye} label="Vigias ativos" value={String(kpis.watchers_active)}
                delta={kpis.alerts_recent > 0 ? `${kpis.alerts_recent} alertas` : "tudo ok"}
                deltaPositive={kpis.alerts_recent === 0} sublabel="" color="#f59e0b" bg="rgba(245,158,11,0.1)" />
              <MetricCard index={3} icon={FolderOpen} label="Projetos ativos" value={String(kpis.projects_active)}
                delta={kpis.projects_at_risk > 0 ? `${kpis.projects_at_risk} em risco` : "em dia"}
                deltaPositive={kpis.projects_at_risk === 0} sublabel="" color="#ef4444" bg="rgba(239,68,68,0.1)" />
              <MetricCard index={4} icon={Database} label="Fontes indexadas" value={String(kpis.sources_indexed)}
                delta={`${kpis.agents_active} agentes`} deltaPositive sublabel="" color="#06b6d4" bg="rgba(6,182,212,0.1)" />
            </div>
          )}

          {/* Marketing section */}
          <motion.div variants={container} initial="hidden" animate="show">
            <motion.div variants={fadeUp}>
              <DashboardCard
                title="Marketing"
                subtitle="Dados de campanhas e tráfego"
                icon={BarChart2}
                iconColor="#f97316"
                action={
                  <Link href="/sources">
                    <span className="text-[11px] text-mota-500 hover:text-mota-400 transition-colors">
                      Conectar fonte
                    </span>
                  </Link>
                }
              >
                {!marketing.has_data ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: "rgba(249,115,22,0.1)" }}>
                      <BarChart2 size={18} className="text-orange-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        Sem dados conectados ainda
                      </p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        Conecte Meta Ads, Google Ads ou GA4 para ver métricas aqui.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {Object.entries(marketing.totals ?? {}).map(([key, val]) => (
                      <div key={key} className="rounded-lg p-3 border"
                        style={{ borderColor: "var(--border-color)", background: "var(--bg-app)" }}>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {MARKETING_LABELS[key] ?? key}
                        </p>
                        <p className="text-lg font-bold tabular-nums mt-0.5"
                          style={{ color: "var(--text-primary)" }}>
                          {fmtMetric(key, val)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </DashboardCard>
            </motion.div>
          </motion.div>

          {/* ── Vendas e Faturamento ──────────────────────────────────────────── */}
          <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">

            {/* Header da seção com período selector */}
            <motion.div variants={fadeUp} className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} className="text-emerald-500" />
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Vendas e Faturamento
                </h3>
                {salesData?.is_consolidated && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-medium">
                    Consolidado
                  </span>
                )}
                {caConnected !== null && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: caConnected ? "rgba(0,199,168,0.1)" : "rgba(148,163,184,0.1)",
                      color:      caConnected ? "#00c7a8"              : "#94a3b8",
                    }}
                  >
                    Conta Azul {caConnected ? "●" : "○"}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {/* Filtro por empresa — disponível apenas em visão consolidada */}
                {salesData?.is_consolidated && (
                  <select
                    value={salesCompanyFilter ?? ""}
                    onChange={e => setSalesCompanyFilter(e.target.value || null)}
                    className="text-[10px] px-2 py-1 rounded-lg border outline-none transition-all"
                    style={{
                      borderColor: salesCompanyFilter ? "#16a34a" : "var(--border-color)",
                      background:  salesCompanyFilter ? "rgba(22,163,74,0.08)" : "var(--bg-card)",
                      color:       salesCompanyFilter ? "#16a34a" : "var(--text-secondary)",
                    }}
                  >
                    <option value="">Todas as empresas</option>
                    {CHILD_COMPANIES_FILTER.map(c => (
                      <option key={c.slug} value={c.slug}>{c.label}</option>
                    ))}
                  </select>
                )}
                {caConnected && (
                  <button
                    onClick={handleCaSync}
                    disabled={caSyncing}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border transition-all disabled:opacity-50"
                    style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
                  >
                    <RefreshCw size={10} className={caSyncing ? "animate-spin" : ""} />
                    {caSyncing ? "Sincronizando..." : "Sincronizar CA"}
                  </button>
                )}
                {(Object.keys(SALES_PERIOD_LABELS) as SalesPeriod[]).filter(p => p !== "custom").map(p => (
                  <button
                    key={p}
                    onClick={() => setSalesPeriod(p)}
                    className="text-[11px] px-2 py-1 rounded-lg border transition-all"
                    style={{
                      borderColor: p === salesPeriod ? "#16a34a" : "var(--border-color)",
                      background:  p === salesPeriod ? "rgba(22,163,74,0.12)" : "transparent",
                      color:       p === salesPeriod ? "#16a34a" : "var(--text-secondary)",
                      fontWeight:  p === salesPeriod ? 600 : 400,
                    }}
                  >
                    {SALES_PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </motion.div>

            {salesError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
                {salesError}
              </div>
            )}

            {/* KPI cards de vendas */}
            <motion.div variants={fadeUp}>
              {(salesLoading && !salesData) ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-xl border h-24 animate-pulse"
                      style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }} />
                  ))}
                </div>
              ) : salesData && (
                <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
                  {[
                    { label: "Receita bruta",   value: fmtBrl(salesData.kpis.gross_revenue),  color: "#16a34a", bg: "rgba(22,163,74,0.1)" },
                    { label: "Receita líquida", value: salesData.kpis.net_revenue > 0 ? fmtBrl(salesData.kpis.net_revenue) : "—", color: "#06b6d4", bg: "rgba(6,182,212,0.1)" },
                    { label: "Vendas",          value: String(salesData.kpis.total_sales),     color: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
                    { label: "Ticket médio",    value: fmtBrl(salesData.kpis.average_ticket),  color: "#8b5cf6", bg: "rgba(139,92,246,0.1)" },
                    { label: "Reembolsos",      value: fmtBrl(salesData.kpis.total_refunds),   color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
                    { label: "Pagas",           value: String(salesData.kpis.paid_sales),      color: "#16a34a", bg: "rgba(22,163,74,0.07)" },
                    { label: "Pendentes",       value: String(salesData.kpis.pending_sales),   color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
                    { label: "Canceladas",      value: String(salesData.kpis.canceled_sales),  color: "#ef4444", bg: "rgba(239,68,68,0.07)" },
                  ].map(({ label, value, color, bg }) => (
                    <div key={label} className="rounded-xl border p-3"
                      style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-2"
                        style={{ background: bg }}>
                        <TrendingUp size={12} style={{ color }} />
                      </div>
                      <p className="text-lg font-bold tabular-nums leading-none" style={{ color }}>
                        {value}
                      </p>
                      <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{label}</p>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Cards info: não mapeadas + última sync + comparação */}
            {salesData && (
              <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-3 gap-3">

                {/* Vendas não mapeadas */}
                <div className="rounded-xl border p-3 flex items-start gap-3"
                  style={{
                    background:  salesData.unmapped_stats.count > 0 ? "rgba(245,158,11,0.06)" : "var(--bg-card)",
                    borderColor: salesData.unmapped_stats.count > 0 ? "rgba(245,158,11,0.3)"  : "var(--border-color)",
                  }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "rgba(245,158,11,0.12)" }}>
                    <AlertCircle size={14} className="text-amber-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Não mapeadas</p>
                    <p className="text-lg font-bold tabular-nums leading-none" style={{ color: salesData.unmapped_stats.count > 0 ? "#f59e0b" : "var(--text-primary)" }}>
                      {salesData.unmapped_stats.count}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {salesData.unmapped_stats.gross > 0 ? fmtBrl(salesData.unmapped_stats.gross) : "sem valor"}
                    </p>
                  </div>
                </div>

                {/* Última sincronização */}
                <div className="rounded-xl border p-3 flex items-start gap-3"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "rgba(6,182,212,0.1)" }}>
                    <RefreshCw size={14} className="text-cyan-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Última sync CA</p>
                    {salesData.last_sync ? (
                      <>
                        <p className="text-xs font-semibold leading-tight" style={{
                          color: salesData.last_sync.status === "success" ? "#16a34a" : salesData.last_sync.status === "error" ? "#ef4444" : "var(--text-primary)",
                        }}>
                          {salesData.last_sync.status === "success" ? "Concluída" : salesData.last_sync.status === "error" ? "Com erro" : salesData.last_sync.status}
                        </p>
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {timeAgo(salesData.last_sync.finished_at ?? salesData.last_sync.started_at)}
                          {salesData.last_sync.inserted != null && ` · ${salesData.last_sync.inserted} inseridas`}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>Nenhuma sync</p>
                    )}
                  </div>
                </div>

                {/* Comparação período anterior */}
                <div className="rounded-xl border p-3 flex items-start gap-3"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "rgba(59,130,246,0.1)" }}>
                    <TrendingUp size={14} className="text-blue-500" />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>vs. período anterior</p>
                    {[
                      { label: "Receita", delta: salesData.comparison.gross_revenue.delta_pct },
                      { label: "Vendas",  delta: salesData.comparison.total_sales.delta_pct },
                      { label: "Ticket",  delta: salesData.comparison.average_ticket.delta_pct },
                    ].map(({ label, delta }) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <span className="text-[10px] w-10" style={{ color: "var(--text-muted)" }}>{label}</span>
                        <span className="text-[10px] font-semibold" style={{
                          color: delta == null ? "var(--text-muted)" : delta >= 0 ? "#16a34a" : "#ef4444",
                        }}>
                          {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta}%`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Gráficos de vendas */}
            {salesData && (
              <motion.div variants={fadeUp}
                className="grid grid-cols-1 xl:grid-cols-2 gap-4">

                {/* Faturamento por dia */}
                <DashboardCard
                  title="Faturamento diário"
                  subtitle={`Receita bruta e líquida — ${SALES_PERIOD_LABELS[salesPeriod]}`}
                  icon={TrendingUp}
                  iconColor="#16a34a"
                >
                  <SalesRevenueChart data={salesData.revenue_by_day} />
                </DashboardCard>

                {/* Por empresa (consolidado) ou por produto */}
                {salesData.is_consolidated ? (
                  <DashboardCard
                    title="Faturamento por empresa"
                    subtitle="Receita bruta consolidada — CPPEM e Unicive"
                    icon={BarChart2}
                    iconColor="#3b82f6"
                  >
                    <SalesByCompanyChart data={salesData.revenue_by_company} />
                  </DashboardCard>
                ) : (
                  <DashboardCard
                    title="Top produtos"
                    subtitle="Receita bruta por produto"
                    icon={BarChart2}
                    iconColor="#3b82f6"
                  >
                    {salesData.revenue_by_product.length === 0 ? (
                      <p className="text-xs py-6 text-center" style={{ color: "var(--text-muted)" }}>
                        Nenhum produto no período
                      </p>
                    ) : (
                      <div className="space-y-2 pt-1">
                        {salesData.revenue_by_product.slice(0, 7).map(p => {
                          const max = salesData.revenue_by_product[0]?.gross ?? 1
                          return (
                            <div key={p.product} className="space-y-0.5">
                              <div className="flex justify-between text-[11px]">
                                <span className="truncate max-w-[60%]" style={{ color: "var(--text-primary)" }}>
                                  {p.product}
                                </span>
                                <span className="shrink-0 font-medium tabular-nums" style={{ color: "var(--text-secondary)" }}>
                                  {fmtBrl(p.gross)} ({p.count})
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full overflow-hidden"
                                style={{ background: "var(--bg-hover)" }}>
                                <div className="h-full rounded-full bg-emerald-500 transition-all"
                                  style={{ width: `${Math.round((p.gross / max) * 100)}%` }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </DashboardCard>
                )}
              </motion.div>
            )}

            {/* Status de pagamento + últimas transações */}
            {salesData && (
              <motion.div variants={fadeUp}
                className="grid grid-cols-1 xl:grid-cols-2 gap-4">

                {/* Status de pagamento */}
                <DashboardCard
                  title="Status de pagamento"
                  subtitle="Distribuição por status"
                  icon={CheckCircle2}
                  iconColor="#16a34a"
                >
                  <SalesPaymentStatusChart data={salesData.revenue_by_payment_status} />
                </DashboardCard>

                {/* Últimas transações */}
                <DashboardCard
                  title="Últimas transações"
                  subtitle={`Vendas recentes — ${SALES_PERIOD_LABELS[salesPeriod]}`}
                  icon={Clock}
                  iconColor="#f59e0b"
                  action={
                    <button
                      onClick={() => setShowManualSale(v => !v)}
                      className="text-[11px] px-2 py-1 rounded-lg border transition-all"
                      style={{
                        borderColor: "rgba(22,163,74,0.3)",
                        background:  "rgba(22,163,74,0.08)",
                        color:       "#16a34a",
                      }}
                    >
                      + Venda teste
                    </button>
                  }
                >
                  {showManualSale && (
                    <ManualSaleForm
                      companySlug={currentCompany?.slug ?? ""}
                      onSaved={() => {
                        setShowManualSale(false)
                        if (currentCompany?.slug) void fetchSales(currentCompany.slug, salesPeriod)
                      }}
                      onCancel={() => setShowManualSale(false)}
                    />
                  )}
                  {salesData.recent_transactions.length === 0 ? (
                    <p className="text-xs py-6 text-center" style={{ color: "var(--text-muted)" }}>
                      Nenhuma transação no período
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {salesData.recent_transactions.slice(0, 8).map(txn => (
                        <div key={txn.id}
                          className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
                          <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
                            style={{
                              background: ["approved","paid","pago","aprovado"].includes(
                                (txn.transaction_status ?? txn.payment_status ?? "").toLowerCase()
                              ) ? "rgba(22,163,74,0.15)" : "rgba(239,68,68,0.1)",
                            }}>
                            {["approved","paid","pago","aprovado"].includes(
                              (txn.transaction_status ?? txn.payment_status ?? "").toLowerCase()
                            )
                              ? <CheckCircle2 size={11} className="text-emerald-500" />
                              : <XCircle      size={11} className="text-red-400" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs truncate" style={{ color: "var(--text-primary)" }}>
                              {txn.product_name ?? "—"}
                            </p>
                            <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                              {txn.customer_name ?? "—"} · {txn.company_id}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-medium tabular-nums" style={{ color: "var(--text-primary)" }}>
                              {txn.gross_amount != null ? fmtBrl(txn.gross_amount) : "—"}
                            </p>
                            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                              {timeAgo(txn.sale_date)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </DashboardCard>
              </motion.div>
            )}
            {/* Evolução mensal + ticket médio */}
            {salesData && (
              <motion.div variants={fadeUp} className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <DashboardCard
                  title="Evolução mensal"
                  subtitle="Receita e ticket médio por mês"
                  icon={BarChart2}
                  iconColor="#8b5cf6"
                >
                  <SalesMonthlyChart data={salesData.revenue_by_month} />
                </DashboardCard>

                <DashboardCard
                  title="Ticket médio por dia"
                  subtitle="Valor médio por venda aprovada"
                  icon={TrendingUp}
                  iconColor="#8b5cf6"
                >
                  <SalesTicketChart data={salesData.revenue_by_day} />
                </DashboardCard>
              </motion.div>
            )}

            {/* Mapeadas vs não mapeadas */}
            {salesData && (
              <motion.div variants={fadeUp}>
                <DashboardCard
                  title="Mapeadas vs não mapeadas"
                  subtitle="Vendas com empresa identificada vs sem identificação"
                  icon={AlertCircle}
                  iconColor="#f59e0b"
                  action={
                    salesData.unmapped_stats.count > 0 ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-500/10 text-amber-500">
                        {salesData.unmapped_stats.count} pendente{salesData.unmapped_stats.count !== 1 ? "s" : ""}
                      </span>
                    ) : undefined
                  }
                >
                  <SalesMappedChart data={{
                    mapped_count:   salesData.kpis.total_sales,
                    unmapped_count: salesData.unmapped_stats.count,
                    mapped_gross:   salesData.kpis.gross_revenue,
                    unmapped_gross: salesData.unmapped_stats.gross,
                  }} />
                </DashboardCard>
              </motion.div>
            )}

          </motion.div>

          {/* Operations row — workflows + projects */}
          <motion.div variants={container} initial="hidden" animate="show"
            className="grid grid-cols-1 xl:grid-cols-2 gap-4">

            {/* Workflow runs */}
            <motion.div variants={fadeUp}>
              <DashboardCard
                title="Execuções de workflow"
                subtitle={`Últimas no período — ${PERIOD_LABELS[period]}`}
                icon={GitBranch}
                iconColor="#8b5cf6"
                action={
                  <Link href="/workflows">
                    <span className="text-[11px] text-mota-500 hover:text-mota-400 transition-colors">
                      Ver todos
                    </span>
                  </Link>
                }
              >
                {(data?.workflow_runs ?? []).length === 0 ? (
                  <p className="text-xs py-6 text-center" style={{ color: "var(--text-muted)" }}>
                    Nenhuma execução no período
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {(data?.workflow_runs ?? []).slice(0, 6).map(run => (
                      <div key={run.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
                        {run.status === "done"
                          ? <CheckCircle2 size={13} style={{ color: statusColor.done }} className="shrink-0" />
                          : run.status === "error"
                          ? <XCircle size={13} style={{ color: statusColor.error }} className="shrink-0" />
                          : <AlertCircle size={13} style={{ color: statusColor.running }} className="shrink-0" />
                        }
                        <span className="flex-1 text-xs truncate" style={{ color: "var(--text-primary)" }}>
                          {run.workflow_name ?? run.workflow_slug ?? "Workflow"}
                        </span>
                        <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
                          {timeAgo(run.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </DashboardCard>
            </motion.div>

            {/* Projects */}
            <motion.div variants={fadeUp}>
              <DashboardCard
                title="Projetos"
                subtitle="Ativos e em risco"
                icon={FolderOpen}
                iconColor="#ef4444"
                action={
                  <Link href="/projects">
                    <span className="text-[11px] text-mota-500 hover:text-mota-400 transition-colors">
                      Ver todos
                    </span>
                  </Link>
                }
              >
                {(data?.projects ?? []).length === 0 ? (
                  <p className="text-xs py-6 text-center" style={{ color: "var(--text-muted)" }}>
                    Nenhum projeto ativo
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {(data?.projects ?? []).slice(0, 6).map(proj => {
                      const atRisk = (data?.projects_at_risk ?? []).some(r => r.id === proj.id)
                      return (
                        <div key={proj.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
                          {atRisk
                            ? <AlertTriangle size={13} style={{ color: "#f59e0b" }} className="shrink-0" />
                            : <CheckCircle2  size={13} style={{ color: "#16a34a" }} className="shrink-0" />
                          }
                          <span className="flex-1 text-xs truncate" style={{ color: "var(--text-primary)" }}>
                            {proj.name}
                          </span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded border shrink-0"
                            style={{
                              background:  priorityBg[proj.priority]   ?? priorityBg.medium,
                              color:       priorityText[proj.priority]  ?? priorityText.medium,
                              borderColor: (priorityText[proj.priority] ?? priorityText.medium) + "40",
                            }}
                          >
                            {priorityLabel[proj.priority] ?? proj.priority}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </DashboardCard>
            </motion.div>
          </motion.div>

          {/* Knowledge / AI row */}
          <motion.div variants={container} initial="hidden" animate="show"
            className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* Agent usage */}
            <motion.div variants={fadeUp} className="md:col-span-2">
              <DashboardCard
                title="Agentes"
                subtitle={`Uso no período — ${PERIOD_LABELS[period]}`}
                icon={Bot}
                iconColor="#06b6d4"
              >
                {agents.length === 0 ? (
                  <p className="text-xs py-6 text-center" style={{ color: "var(--text-muted)" }}>
                    Nenhuma sessão com agentes no período
                  </p>
                ) : (
                  <AgentBarChart
                    data={agents.map(a => ({
                      name:     a.shortName,
                      fullName: a.name,
                      uses:     a.sessions,
                      color:    a.color,
                    }))}
                  />
                )}
              </DashboardCard>
            </motion.div>

            {/* Sources & RAG */}
            <motion.div variants={fadeUp}>
              <DashboardCard
                title="Conhecimento"
                subtitle="Fontes e embeddings"
                icon={Database}
                iconColor="#06b6d4"
                action={
                  <Link href="/sources">
                    <span className="text-[11px] text-mota-500 hover:text-mota-400 transition-colors">
                      Gerenciar
                    </span>
                  </Link>
                }
              >
                <div className="space-y-3">
                  {/* RAG chunks */}
                  <div className="flex items-center justify-between p-3 rounded-lg border"
                    style={{ borderColor: "var(--border-color)", background: "var(--bg-app)" }}>
                    <div className="flex items-center gap-2">
                      <Layers size={14} className="text-mota-500" />
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>Chunks RAG</span>
                    </div>
                    <span className="text-sm font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {(kpis?.rag_chunks ?? 0).toLocaleString("pt-BR")}
                    </span>
                  </div>

                  {/* Sources breakdown */}
                  {Object.entries(data?.sources?.breakdown ?? {}).filter(([, n]) => n > 0).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between px-1">
                      <span className="text-[11px] capitalize" style={{ color: "var(--text-muted)" }}>
                        {status === "done" ? "Indexadas" : status === "pending" ? "Pendentes" : status === "error" ? "Com erro" : status}
                      </span>
                      <span className="text-[11px] font-medium" style={{
                        color: status === "done" ? "#16a34a" : status === "error" ? "#ef4444" : "var(--text-secondary)",
                      }}>
                        {count}
                      </span>
                    </div>
                  ))}

                  {(data?.sources?.items ?? []).length === 0 && (
                    <p className="text-[11px] text-center py-2" style={{ color: "var(--text-muted)" }}>
                      Nenhuma fonte cadastrada
                    </p>
                  )}
                </div>
              </DashboardCard>
            </motion.div>
          </motion.div>

          {/* Activity + AI Analysis row */}
          <motion.div variants={container} initial="hidden" animate="show"
            className="grid grid-cols-1 xl:grid-cols-2 gap-4">

            {/* Activity feed */}
            <motion.div variants={fadeUp}>
              <DashboardCard
                title="Atividade recente"
                subtitle={`Logs de ações — ${PERIOD_LABELS[period]}`}
                icon={Activity}
                iconColor="#16a34a"
              >
                {(data?.activity ?? []).length === 0 ? (
                  <p className="text-xs py-6 text-center" style={{ color: "var(--text-muted)" }}>
                    Nenhuma atividade no período
                  </p>
                ) : (
                  <div className="space-y-1">
                    {(data?.activity ?? []).slice(0, 12).map(log => {
                      const Icon = eventIcon[log.event_type] ?? Activity
                      return (
                        <div key={log.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
                          <Icon size={12} className="mt-0.5 shrink-0" style={{ color: "var(--text-muted)" }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs truncate" style={{ color: "var(--text-primary)" }}>
                              {log.action}
                            </p>
                            {log.detail && (
                              <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                                {log.detail}
                              </p>
                            )}
                          </div>
                          <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>
                            {timeAgo(log.created_at)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </DashboardCard>
            </motion.div>

            {/* AI Analysis */}
            <motion.div variants={fadeUp}>
              <DashboardCard
                title="Análise executiva IA"
                subtitle="Gerada pelo Jarvis — inclui dados financeiros"
                icon={Sparkles}
                iconColor="#8b5cf6"
                action={
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => void createManualSnapshot()}
                      disabled={snapshotSaving}
                      className="text-[10px] px-2 py-1 rounded-lg border transition-all disabled:opacity-50"
                      style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
                      title="Salvar snapshot com KPIs atuais sem gerar análise IA"
                    >
                      {snapshotSaving ? "..." : "Snapshot"}
                    </button>
                    <button
                      onClick={() => void generateAnalysis()}
                      disabled={analysisLoading}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all disabled:opacity-50"
                      style={{
                        borderColor: "rgba(139,92,246,0.3)",
                        background:  "rgba(139,92,246,0.08)",
                        color:       "#a78bfa",
                      }}
                    >
                      <Sparkles size={11} className={analysisLoading ? "animate-pulse" : ""} />
                      {analysisLoading ? "Gerando..." : "Gerar análise"}
                    </button>
                  </div>
                }
              >
                {(analysisError || snapshotMsg) && (
                  <p className={`text-xs mb-3 ${analysisError ? "text-red-400" : "text-emerald-500"}`}>
                    {analysisError ?? snapshotMsg}
                  </p>
                )}

                <AnimatePresence mode="wait">
                  {!latestSnapshot?.ai_analysis ? (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center justify-center py-8 gap-3"
                    >
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ background: "rgba(139,92,246,0.1)" }}>
                        <Sparkles size={18} style={{ color: "#a78bfa" }} />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          Nenhuma análise ainda
                        </p>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                          Clique em "Gerar análise" para criar um relatório executivo com IA.
                        </p>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="analysis"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      <div className="flex items-center gap-2 mb-3 pb-3 border-b"
                        style={{ borderColor: "var(--border-color)" }}>
                        <Clock size={11} style={{ color: "var(--text-muted)" }} />
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {timeAgo(latestSnapshot.created_at)} · período: {latestSnapshot.period}
                        </span>
                      </div>
                      <div
                        className="text-xs leading-relaxed prose prose-sm max-w-none"
                        style={{ color: "var(--text-secondary)" }}
                        dangerouslySetInnerHTML={{
                          __html: (latestSnapshot.ai_analysis ?? "")
                            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                            .replace(/\n\n/g, "</p><p class='mt-2'>")
                            .replace(/\n/g, "<br/>"),
                        }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </DashboardCard>
            </motion.div>

          </motion.div>

          {/* Workflow activity chart */}
          {data && (
            <motion.div variants={container} initial="hidden" animate="show">
              <motion.div variants={fadeUp}>
                <DashboardCard
                  title="Atividade de workflows"
                  subtitle={`Execuções — ${PERIOD_LABELS[period]}`}
                  icon={TrendingUp}
                  iconColor="#16a34a"
                >
                  <WeeklyActivityChart data={weeklyData} />
                </DashboardCard>
              </motion.div>
            </motion.div>
          )}

        </div>
      </div>
    </div>
  )
}

// ─── ManualSaleForm ───────────────────────────────────────────────────────────

const CHILD_COMPANIES = [
  { slug: "cppem",   label: "CPPEM Concursos" },
  { slug: "unicive", label: "Unicive" },
  { slug: "colegio", label: "Colégio" },
  { slug: "everton", label: "Everton" },
]

function ManualSaleForm({
  companySlug,
  onSaved,
  onCancel,
}: {
  companySlug: string
  onSaved:     () => void
  onCancel:    () => void
}) {
  // Se for grupo (visão consolidada), exige selecionar empresa-filha
  const isConsolidated = companySlug === "grupo"
  const [saving,  setSaving]  = useState(false)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)
  const [form,    setForm]    = useState({
    company_id:         isConsolidated ? "cppem" : companySlug,
    product_name:       "",
    customer_name:      "",
    gross_amount:       "",
    net_amount:         "",
    payment_status:     "paid",
    transaction_status: "approved",
    payment_method:     "",
    sale_date:          new Date().toISOString().slice(0, 10),
  })

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErrMsg(null)
    try {
      const res = await fetch("/api/sales/manual", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id:         form.company_id,
          product_name:       form.product_name,
          customer_name:      form.customer_name || undefined,
          gross_amount:       parseFloat(form.gross_amount),
          net_amount:         form.net_amount ? parseFloat(form.net_amount) : undefined,
          payment_status:     form.payment_status,
          transaction_status: form.transaction_status,
          payment_method:     form.payment_method || undefined,
          sale_date:          form.sale_date,
        }),
      })
      const json = await res.json() as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar")
      onSaved()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : "Erro")
    } finally {
      setSaving(false)
    }
  }

  const inputCls = "w-full rounded-lg px-2.5 py-1.5 text-xs border outline-none"
  const inputStyle = { borderColor: "var(--border-color)", background: "var(--bg-card)", color: "var(--text-primary)" }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="mb-4 p-3 rounded-xl border space-y-2.5"
      style={{ borderColor: "var(--border-color)", background: "var(--bg-app)" }}>
      <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
        Inserir venda de teste
      </p>
      {errMsg && <p className="text-xs text-red-400">{errMsg}</p>}
      <div className="grid grid-cols-2 gap-2">
        {/* Empresa — obrigatório apenas em visão consolidada */}
        {isConsolidated && (
          <select
            value={form.company_id}
            onChange={e => set("company_id", e.target.value)}
            className={`col-span-2 ${inputCls}`}
            style={inputStyle}
          >
            {CHILD_COMPANIES.map(c => (
              <option key={c.slug} value={c.slug}>{c.label}</option>
            ))}
          </select>
        )}
        <input
          required
          placeholder="Produto *"
          value={form.product_name}
          onChange={e => set("product_name", e.target.value)}
          className={`col-span-2 ${inputCls}`}
          style={inputStyle}
        />
        <input
          placeholder="Cliente"
          value={form.customer_name}
          onChange={e => set("customer_name", e.target.value)}
          className={inputCls}
          style={inputStyle}
        />
        <input
          required
          type="number"
          min="0.01"
          step="0.01"
          placeholder="Valor bruto (R$) *"
          value={form.gross_amount}
          onChange={e => set("gross_amount", e.target.value)}
          className={inputCls}
          style={inputStyle}
        />
        <input
          type="number"
          min="0.01"
          step="0.01"
          placeholder="Valor líquido (R$)"
          value={form.net_amount}
          onChange={e => set("net_amount", e.target.value)}
          className={inputCls}
          style={inputStyle}
        />
        <input
          type="date"
          value={form.sale_date}
          onChange={e => set("sale_date", e.target.value)}
          className={inputCls}
          style={inputStyle}
        />
        <select
          value={form.payment_status}
          onChange={e => set("payment_status", e.target.value)}
          className={inputCls}
          style={inputStyle}
        >
          <option value="paid">Pago</option>
          <option value="pending">Pendente</option>
          <option value="canceled">Cancelado</option>
        </select>
        <select
          value={form.payment_method}
          onChange={e => set("payment_method", e.target.value)}
          className={inputCls}
          style={inputStyle}
        >
          <option value="">Forma de pagamento</option>
          <option value="credit_card">Cartão de crédito</option>
          <option value="pix">PIX</option>
          <option value="boleto">Boleto</option>
          <option value="debit_card">Cartão de débito</option>
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel}
          className="text-xs px-2.5 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)]"
          style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
          Cancelar
        </button>
        <button type="submit" disabled={saving}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </form>
  )
}
