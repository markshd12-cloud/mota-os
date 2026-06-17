"use client"

import { useState, useEffect, useTransition, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Zap, Play, Pause, Plus, Clock, CalendarClock, Eye,
  Megaphone, BarChart3, ListChecks, MessageCircle, Search,
  Globe, Rocket, AlertTriangle, TrendingDown,
  Pencil, Trash2, ChevronDown, ChevronUp, Loader2, X,
  CheckCircle2, XCircle, History, Bell, TrendingUp, Users,
} from "lucide-react"
import { PageHeader }   from "@/components/ui/PageHeader"
import { skills }       from "@/lib/mocks/automations"
import { workflows }    from "@/lib/mocks/workflows"
import { cn }           from "@/lib/utils"
import { useCompany, type CompanyInfo } from "@/components/providers/CompanyProvider"
import type { AutomationRow, WatcherRow } from "./page"

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "skills" | "automations" | "watchers"

type RunLog = {
  id:            string
  status:        "running" | "done" | "error"
  output:        string | null
  error_message: string | null
  started_at:    string
  finished_at:   string | null
}

type WatcherLog = {
  id:            string
  status:        "ok" | "alert" | "warning" | "error"
  triggered:     boolean
  message:       string
  result:        Record<string, unknown>
  result_data:   Record<string, unknown>
  matched_count: number
  error_message: string | null
  started_at:    string
  finished_at:   string | null
}

type CheckResult = {
  status:        "ok" | "alert" | "warning" | "error"
  message:       string
  triggered:     boolean
  matched_count: number
  result:        Record<string, unknown>
  error_message: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FREQUENCY_LABELS: Record<string, string> = {
  manual:  "Manual",
  daily:   "Diário",
  weekly:  "Semanal",
  monthly: "Mensal",
}

const WATCHER_FREQ_LABELS: Record<string, string> = {
  manual:  "Manual",
  hourly:  "A cada hora",
  daily:   "Diário",
  weekly:  "Semanal",
  monthly: "Mensal",
}

const WATCHER_TYPE_INFO: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  overdue_tasks:             { label: "Tarefas atrasadas",          icon: AlertTriangle, color: "#f97316" },
  sessions_without_response: { label: "Sessão sem resposta da IA",  icon: MessageCircle, color: "#f59e0b" },
  sessions_no_ai:            { label: "Sessão sem resposta da IA",  icon: MessageCircle, color: "#f59e0b" },
  workflow_errors:           { label: "Erros de workflow",          icon: CalendarClock, color: "#3b82f6" },
  workflow_not_run:          { label: "Workflow não executado",     icon: CalendarClock, color: "#3b82f6" },
  automation_errors:         { label: "Erros de automações",        icon: XCircle,       color: "#ef4444" },
  automation_error:          { label: "Erros de automações",        icon: XCircle,       color: "#ef4444" },
  high_cpl:                  { label: "CPL alto",                  icon: TrendingUp,    color: "#ef4444" },
  cpl_above_limit:           { label: "CPL acima do limite",        icon: TrendingUp,    color: "#ef4444" },
  campaign_without_leads:    { label: "Campanha sem leads",         icon: Users,         color: "#8b5cf6" },
  campaign_no_leads:         { label: "Campanha sem leads",         icon: Users,         color: "#8b5cf6" },
  inactive_agent:            { label: "Agente inativo",             icon: Users,         color: "#64748b" },
  failed_api_connection:     { label: "Conexão de API com erro",   icon: XCircle,       color: "#ef4444" },
  project_deadline_risk:     { label: "Risco de prazo de projeto", icon: AlertTriangle, color: "#f97316" },
}

const SELECT_WATCHER_TYPES = [
  { value: "overdue_tasks",             label: "Tarefas atrasadas" },
  { value: "sessions_without_response", label: "Sessão sem resposta da IA" },
  { value: "workflow_errors",           label: "Erros de workflow" },
  { value: "automation_errors",         label: "Erros de automações" },
  { value: "high_cpl",                  label: "CPL alto" },
  { value: "campaign_without_leads",    label: "Campanha sem leads" },
  { value: "inactive_agent",            label: "Agente inativo" },
  { value: "failed_api_connection",     label: "Conexão de API com erro" },
  { value: "project_deadline_risk",     label: "Risco de prazo de projeto" },
]

const DAYS_OF_WEEK = [
  { value: "segunda", label: "Seg" },
  { value: "terca",   label: "Ter" },
  { value: "quarta",  label: "Qua" },
  { value: "quinta",  label: "Qui" },
  { value: "sexta",   label: "Sex" },
  { value: "sabado",  label: "Sáb" },
  { value: "domingo", label: "Dom" },
]

const iconMap: Record<string, React.ElementType> = {
  Megaphone, BarChart3, ListChecks, MessageCircle, Search,
  Globe, Rocket, AlertTriangle, TrendingDown, Zap, Calendar: CalendarClock,
}

function watcherStatusColor(status: string) {
  if (status === "ok")      return "#16a34a"
  if (status === "alert")   return "#f59e0b"
  if (status === "warning") return "#64748b"
  return "#ef4444"
}

function WatcherStatusIcon({ status, size = 14 }: { status: string; size?: number }) {
  if (status === "ok")    return <CheckCircle2 size={size} />
  if (status === "alert" || status === "warning") return <AlertTriangle size={size} />
  return <XCircle size={size} />
}

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

function timeAgo(iso: string | null) {
  if (!iso) return "nunca"
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return "agora"
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)} dias`
}

// ─── Shared modal shell ───────────────────────────────────────────────────────

function ModalShell({
  title, onClose, children,
}: {
  title:    string
  onClose:  () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className="relative w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-color)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-muted)" }}>
            <X size={15} />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  )
}

// ─── Automation Modal ─────────────────────────────────────────────────────────

function AutomationModal({
  mode, initial, onClose, onSave, allowedCompanies, defaultCompanyId,
}: {
  mode:             "create" | "edit"
  initial?:         Partial<AutomationRow>
  onClose:          () => void
  onSave:           (data: Partial<AutomationRow>) => Promise<void>
  allowedCompanies: CompanyInfo[]
  defaultCompanyId: string
}) {
  const [name,        setName]    = useState(initial?.name        ?? "")
  const [description, setDesc]    = useState(initial?.description ?? "")
  const [workflowId,  setWfId]    = useState(initial?.workflow_id ?? "")
  const [companyId,   setCompany] = useState(initial?.company_id  ?? defaultCompanyId)
  const [frequency,   setFreq]    = useState<AutomationRow["frequency"]>(initial?.frequency ?? "manual")
  const [context,     setContext] = useState(initial?.config?.context ?? "")
  const [saving,      setSaving]  = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim() || !workflowId) return
    setSaving(true)
    await onSave({
      name: name.trim(), description: description.trim(),
      workflow_id: workflowId, company_id: companyId, frequency,
      config: { ...(initial?.config ?? {}), context: context.trim() || undefined },
    })
    setSaving(false)
  }

  const inputCls   = "w-full text-sm px-3 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-mota-500/40 transition-all"
  const inputStyle = { background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }

  return (
    <ModalShell title={mode === "create" ? "Nova automação" : "Editar automação"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Nome *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ex: Relatório diário de tráfego" className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Descrição</label>
          <input value={description} onChange={(e) => setDesc(e.target.value)} placeholder="Descreva o que esta automação faz" className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Workflow *</label>
          <select value={workflowId} onChange={(e) => setWfId(e.target.value)} required className={inputCls} style={inputStyle}>
            <option value="">Selecione um workflow</option>
            {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Empresa</label>
            <select value={companyId} onChange={(e) => setCompany(e.target.value)} className={inputCls} style={inputStyle}>
              {allowedCompanies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Frequência</label>
            <select value={frequency} onChange={(e) => setFreq(e.target.value as AutomationRow["frequency"])} className={inputCls} style={inputStyle}>
              {(Object.entries(FREQUENCY_LABELS) as [AutomationRow["frequency"], string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Contexto adicional</label>
          <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={3} placeholder="Informações fixas para incluir em toda execução (opcional)" className={`${inputCls} resize-none`} style={inputStyle} />
        </div>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 text-sm py-2.5 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]" style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>Cancelar</button>
          <button type="submit" disabled={saving || !name.trim() || !workflowId} className="flex-1 flex items-center justify-center gap-2 text-sm py-2.5 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {mode === "create" ? "Criar" : "Salvar"}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

// ─── Watcher Condition Fields ─────────────────────────────────────────────────

function ConditionFields({
  type, condition, onChange, allowedCompanies,
}: {
  type:             string
  condition:        Record<string, unknown>
  onChange:         (key: string, value: unknown) => void
  allowedCompanies: CompanyInfo[]
}) {
  const inputCls   = "w-full text-sm px-3 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-mota-500/40 transition-all"
  const inputStyle = { background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }
  const labelCls   = "text-xs font-medium mb-1.5 block"

  if (type === "overdue_tasks") return (
    <div>
      <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Filtrar por empresa (opcional)</label>
      <select value={String(condition.company_id ?? "")} onChange={(e) => onChange("company_id", e.target.value || undefined)} className={inputCls} style={inputStyle}>
        <option value="">Todas as empresas</option>
        {allowedCompanies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
      </select>
    </div>
  )

  if (type === "sessions_without_response" || type === "sessions_no_ai") return (
    <div>
      <label className={labelCls} style={{ color: "var(--text-secondary)" }}>
        {type === "sessions_no_ai" ? "Alertar após N minutos sem resposta" : "Alertar após N horas sem resposta"}
      </label>
      {type === "sessions_no_ai"
        ? <input type="number" min={1} value={String(condition.minutes ?? 30)} onChange={(e) => onChange("minutes", Number(e.target.value))} className={inputCls} style={inputStyle} />
        : <input type="number" min={1} value={String(condition.threshold_hours ?? 2)} onChange={(e) => onChange("threshold_hours", Number(e.target.value))} className={inputCls} style={inputStyle} />
      }
    </div>
  )

  if (type === "workflow_errors") return (
    <div>
      <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Verificar erros nas últimas N horas</label>
      <input type="number" min={1} value={String(condition.lookback_hours ?? 24)} onChange={(e) => onChange("lookback_hours", Number(e.target.value))} className={inputCls} style={inputStyle} />
    </div>
  )

  if (type === "workflow_not_run") return (
    <div className="space-y-3">
      <div>
        <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Workflow a monitorar</label>
        <select value={String(condition.workflow_slug ?? "")} onChange={(e) => { const w = workflows.find((x) => x.id === e.target.value); onChange("workflow_slug", e.target.value); onChange("workflow_name", w?.name ?? "") }} className={inputCls} style={inputStyle}>
          <option value="">Qualquer workflow</option>
          {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Alertar se não executado nas últimas N horas</label>
        <input type="number" min={1} value={String(condition.hours ?? 24)} onChange={(e) => onChange("hours", Number(e.target.value))} className={inputCls} style={inputStyle} />
      </div>
    </div>
  )

  if (type === "automation_errors" || type === "automation_error") return (
    <div>
      <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Verificar erros nas últimas N horas</label>
      <input type="number" min={1} value={String(condition.lookback_hours ?? condition.hours ?? 24)} onChange={(e) => onChange("lookback_hours", Number(e.target.value))} className={inputCls} style={inputStyle} />
    </div>
  )

  if (type === "high_cpl" || type === "cpl_above_limit") return (
    <div className="space-y-3">
      <div>
        <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Campanha (identificação)</label>
        <input type="text" value={String(condition.campaign ?? "")} onChange={(e) => onChange("campaign", e.target.value)} placeholder="Ex: PMPE 2026 — Meta Ads" className={inputCls} style={inputStyle} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Limite CPL (R$) *</label>
          <input type="number" min={0} step={0.01} value={String(condition.threshold ?? condition.limit ?? "")} onChange={(e) => onChange("threshold", Number(e.target.value))} placeholder="6.00" className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className={labelCls} style={{ color: "var(--text-secondary)" }}>CPL atual (R$)</label>
          <input type="number" min={0} step={0.01} value={String(condition.current_cpl ?? "")} onChange={(e) => onChange("current_cpl", Number(e.target.value))} placeholder="0.00" className={inputCls} style={inputStyle} />
        </div>
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Atualize o CPL atual antes de executar o vigia.</p>
    </div>
  )

  if (type === "campaign_without_leads" || type === "campaign_no_leads") return (
    <div className="space-y-3">
      <div>
        <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Campanha (identificação)</label>
        <input type="text" value={String(condition.campaign ?? "")} onChange={(e) => onChange("campaign", e.target.value)} placeholder="Ex: PMPE 2026 — Leads Form" className={inputCls} style={inputStyle} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Meta de leads *</label>
          <input type="number" min={0} value={String(condition.expected_leads ?? "")} onChange={(e) => onChange("expected_leads", Number(e.target.value))} placeholder="50" className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Leads atuais</label>
          <input type="number" min={0} value={String(condition.current_leads ?? "")} onChange={(e) => onChange("current_leads", Number(e.target.value))} placeholder="0" className={inputCls} style={inputStyle} />
        </div>
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Atualize os leads atuais antes de executar o vigia.</p>
    </div>
  )

  if (type === "inactive_agent") return (
    <div>
      <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Alertar se sem uso nos últimos N dias</label>
      <input type="number" min={1} value={String(condition.days ?? 7)} onChange={(e) => onChange("days", Number(e.target.value))} className={inputCls} style={inputStyle} />
    </div>
  )

  if (type === "failed_api_connection") return (
    <p className="text-xs" style={{ color: "var(--text-muted)" }}>Nenhuma configuração necessária — verifica automaticamente todas as conexões de API com status de erro.</p>
  )

  if (type === "project_deadline_risk") return (
    <div>
      <label className={labelCls} style={{ color: "var(--text-secondary)" }}>Alertar se prazo em menos de N dias</label>
      <input type="number" min={1} value={String(condition.days_before_due ?? condition.days ?? 7)} onChange={(e) => onChange("days_before_due", Number(e.target.value))} className={inputCls} style={inputStyle} />
    </div>
  )

  return null
}

// ─── Watcher Modal ────────────────────────────────────────────────────────────

function WatcherModal({
  mode, initial, onClose, onSave, allowedCompanies, defaultCompanyId,
}: {
  mode:             "create" | "edit"
  initial?:         Partial<WatcherRow>
  onClose:          () => void
  onSave:           (data: Partial<WatcherRow>) => Promise<void>
  allowedCompanies: CompanyInfo[]
  defaultCompanyId: string
}) {
  const [name,         setName]       = useState(initial?.name                  ?? "")
  const [description,  setDesc]       = useState(initial?.description           ?? "")
  const [companyId,    setCompany]    = useState(initial?.company_id            ?? defaultCompanyId)
  const [type,         setType]       = useState(initial?.watcher_type          ?? "overdue_tasks")
  const [condition,    setCondition]  = useState<Record<string, unknown>>(initial?.condition ?? {})
  const [frequency,    setFreq]       = useState<WatcherRow["frequency"]>(initial?.frequency ?? "manual")
  const [scheduleTime, setSchedTime]  = useState(initial?.schedule_time         ?? "")
  const [timezone,     setTimezone]   = useState(initial?.timezone              ?? "America/Recife")
  const [daysOfWeek,   setDaysOfWeek] = useState<string[]>(initial?.days_of_week ?? [])
  const [notifyChannel, setNotifyChannel] = useState<string>(
    (initial?.notification_config?.channel as string) ?? initial?.notification_channel ?? "dashboard"
  )
  const [saving,       setSaving]     = useState(false)

  function setCondField(key: string, value: unknown) {
    setCondition((prev) => ({ ...prev, [key]: value }))
  }

  function toggleDay(day: string) {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    await onSave({
      name: name.trim(), description: description.trim(),
      company_id: companyId, watcher_type: type,
      condition, condition_config: condition,
      frequency,
      schedule_time: scheduleTime.trim() || null,
      timezone,
      days_of_week: daysOfWeek.length > 0 ? daysOfWeek : null,
      notification_channel: notifyChannel,
      notification_config: { channel: notifyChannel },
    })
    setSaving(false)
  }

  const inputCls   = "w-full text-sm px-3 py-2.5 rounded-xl border outline-none focus:ring-2 focus:ring-mota-500/40 transition-all"
  const inputStyle = { background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }
  const showSchedule = frequency !== "manual" && frequency !== "hourly"

  return (
    <ModalShell title={mode === "create" ? "Novo vigia" : "Editar vigia"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Nome *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ex: CPL acima do limite" className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Descrição</label>
          <input value={description} onChange={(e) => setDesc(e.target.value)} placeholder="Descreva o que este vigia monitora" className={inputCls} style={inputStyle} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Empresa</label>
            <select value={companyId} onChange={(e) => setCompany(e.target.value)} className={inputCls} style={inputStyle}>
              {allowedCompanies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Frequência</label>
            <select value={frequency} onChange={(e) => setFreq(e.target.value as WatcherRow["frequency"])} className={inputCls} style={inputStyle}>
              {Object.entries(WATCHER_FREQ_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {showSchedule && (
          <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: "var(--border-color)" }}>
            <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Agendamento</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Horário (HH:mm)</label>
                <input type="time" value={scheduleTime} onChange={(e) => setSchedTime(e.target.value)} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Fuso horário</label>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls} style={inputStyle}>
                  <option value="America/Recife">Recife (BRT)</option>
                  <option value="America/Sao_Paulo">São Paulo (BRT)</option>
                  <option value="America/Manaus">Manaus (AMT)</option>
                  <option value="America/Belem">Belém (BRT)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
            </div>
            {frequency === "weekly" && (
              <div>
                <label className="text-xs mb-2 block" style={{ color: "var(--text-muted)" }}>Dias da semana</label>
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS_OF_WEEK.map((d) => (
                    <button key={d.value} type="button" onClick={() => toggleDay(d.value)}
                      className={cn("text-[11px] px-2.5 py-1 rounded-lg border transition-colors font-medium",
                        daysOfWeek.includes(d.value)
                          ? "bg-mota-600 text-white border-mota-600"
                          : "hover:bg-[var(--bg-hover)]")}
                      style={daysOfWeek.includes(d.value) ? undefined : { borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Notificar via</label>
          <select value={notifyChannel} onChange={(e) => setNotifyChannel(e.target.value)} className={inputCls} style={inputStyle}>
            <option value="dashboard">Painel (somente no app)</option>
            <option value="rocketchat">Rocket.Chat (canal de alertas)</option>
          </select>
          {notifyChannel === "rocketchat" && (
            <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
              Usa o destino padrão tipo &quot;Vigias&quot; em Configurações &gt; APIs &gt; Destinos Rocket.Chat.
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-secondary)" }}>Tipo de verificação *</label>
          <select value={type} onChange={(e) => { setType(e.target.value); setCondition({}) }} className={inputCls} style={inputStyle}>
            {SELECT_WATCHER_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--border-color)", background: "var(--bg-input)" }}>
          <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Condição</p>
          <ConditionFields type={type} condition={condition} onChange={setCondField} allowedCompanies={allowedCompanies} />
        </div>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 text-sm py-2.5 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]" style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>Cancelar</button>
          <button type="submit" disabled={saving || !name.trim()} className="flex-1 flex items-center justify-center gap-2 text-sm py-2.5 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />}
            {mode === "create" ? "Criar vigia" : "Salvar"}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

// ─── Output panel (automations) ───────────────────────────────────────────────

function RunOutputPanel({ output, onClose }: { output: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-2xl max-h-[80vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: "var(--border-color)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Resultado da execução</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-muted)" }}><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <pre className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)", fontFamily: "inherit" }}>{output}</pre>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Check result panel (watchers) ────────────────────────────────────────────

function CheckResultPanel({ result, onClose }: { result: CheckResult; onClose: () => void }) {
  const color = watcherStatusColor(result.status)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-color)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Resultado do vigia</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-muted)" }}><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-xl border" style={{ borderColor: `${color}30`, background: `${color}0d` }}>
            <span style={{ color, flexShrink: 0 }}><WatcherStatusIcon status={result.status} size={20} /></span>
            <p className="text-sm font-medium" style={{ color }}>{result.message}</p>
          </div>
          {result.error_message && (
            <div className="rounded-xl p-3 border text-xs" style={{ borderColor: "rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)", color: "#f87171", fontFamily: "inherit" }}>
              {result.error_message}
            </div>
          )}
          {result.matched_count > 0 && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{result.matched_count} item(ns) encontrado(s)</p>
          )}
          {Object.keys(result.result).length > 0 && (
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>Dados retornados</p>
              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap rounded-xl p-3 border max-h-60 overflow-y-auto"
                style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-secondary)", fontFamily: "inherit" }}>
                {JSON.stringify(result.result, null, 2)}
              </pre>
            </div>
          )}
          <button onClick={onClose} className="w-full text-sm py-2.5 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors">Fechar</button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Automation logs panel ────────────────────────────────────────────────────

function AutoLogsPanel({ automationId, onClose }: { automationId: string; onClose: () => void }) {
  const [logs,     setLogs]     = useState<RunLog[] | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/automations/${automationId}/logs`)
      .then((r) => r.json())
      .then((data) => { setLogs(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => { setLogs([]); setLoading(false) })
  }, [automationId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-xl max-h-[80vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: "var(--border-color)" }}>
          <div className="flex items-center gap-2">
            <History size={14} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Histórico de execuções</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-muted)" }}><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>}
          {!loading && !logs?.length && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <History size={24} style={{ color: "var(--text-muted)" }} />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Nenhuma execução ainda</p>
            </div>
          )}
          {!loading && !!logs?.length && (
            <div className="divide-y" style={{ borderColor: "var(--border-color)" }}>
              {logs.map((log) => (
                <div key={log.id} className="px-5 py-3">
                  <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(expanded === log.id ? null : log.id)}>
                    {log.status === "done"    && <CheckCircle2 size={14} className="shrink-0 text-mota-500" />}
                    {log.status === "error"   && <XCircle      size={14} className="shrink-0 text-red-400"  />}
                    {log.status === "running" && <Loader2      size={14} className="shrink-0 animate-spin"  style={{ color: "var(--text-muted)" }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                        {log.status === "done" ? "Concluído" : log.status === "error" ? "Erro" : "Em execução"}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {fmtDate(log.started_at)}
                        {log.finished_at && ` · ${Math.round((new Date(log.finished_at).getTime() - new Date(log.started_at).getTime()) / 1000)}s`}
                      </p>
                    </div>
                    {(log.output || log.error_message) && (expanded === log.id ? <ChevronUp size={13} style={{ color: "var(--text-muted)" }} /> : <ChevronDown size={13} style={{ color: "var(--text-muted)" }} />)}
                  </div>
                  <AnimatePresence>
                    {expanded === log.id && (log.output || log.error_message) && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                        <pre className="mt-2 text-[11px] leading-relaxed whitespace-pre-wrap rounded-lg p-3 border max-h-40 overflow-y-auto"
                          style={{ background: log.error_message ? "rgba(239,68,68,0.06)" : "var(--bg-input)", borderColor: log.error_message ? "rgba(239,68,68,0.2)" : "var(--border-color)", color: log.error_message ? "#f87171" : "var(--text-secondary)", fontFamily: "inherit" }}>
                          {log.error_message ?? log.output}
                        </pre>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ─── Watcher logs panel ───────────────────────────────────────────────────────

function WatcherLogsPanel({ watcherId, onClose }: { watcherId: string; onClose: () => void }) {
  const [logs,    setLogs]    = useState<WatcherLog[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/watchers/${watcherId}/logs`)
      .then((r) => r.json())
      .then((data) => { setLogs(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => { setLogs([]); setLoading(false) })
  }, [watcherId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-xl max-h-[80vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: "var(--border-color)" }}>
          <div className="flex items-center gap-2">
            <History size={14} style={{ color: "var(--text-muted)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Histórico de verificações</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)] transition-colors" style={{ color: "var(--text-muted)" }}><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} /></div>}
          {!loading && !logs?.length && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <History size={24} style={{ color: "var(--text-muted)" }} />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Nenhuma verificação ainda</p>
            </div>
          )}
          {!loading && !!logs?.length && (
            <div className="divide-y" style={{ borderColor: "var(--border-color)" }}>
              {logs.map((log) => {
                const color = watcherStatusColor(log.status)
                return (
                  <div key={log.id} className="px-5 py-3 flex items-start gap-3">
                    <span className="shrink-0 mt-0.5" style={{ color }}><WatcherStatusIcon status={log.status} /></span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{log.message}</p>
                      {log.error_message && (
                        <p className="text-[10px] mt-0.5" style={{ color: "#f87171" }}>{log.error_message}</p>
                      )}
                      <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {fmtDate(log.started_at)}
                        {log.matched_count > 0 && ` · ${log.matched_count} item(ns)`}
                      </p>
                    </div>
                    {log.triggered && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>Alerta</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ─── Automation card ──────────────────────────────────────────────────────────

function AutomationCard({
  automation, onEdit, onDelete, onToggle, onRun, onViewLogs,
}: {
  automation: AutomationRow
  onEdit:     (a: AutomationRow) => void
  onDelete:   (id: string) => void
  onToggle:   (id: string, s: "active" | "paused") => void
  onRun:      (id: string) => void
  onViewLogs: (id: string) => void
}) {
  const workflow = workflows.find((w) => w.id === automation.workflow_id)
  const [running, startRun] = useTransition()

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }}
      className="rounded-2xl border p-5" style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(139,92,246,0.1)" }}>
          <CalendarClock size={18} style={{ color: "#8b5cf6" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{automation.name}</p>
              {automation.description && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--text-secondary)" }}>{automation.description}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => onToggle(automation.id, automation.status === "active" ? "paused" : "active")}
                className={cn("flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors",
                  automation.status === "active" ? "bg-mota-500/10 text-mota-500 hover:bg-mota-500/20" : "bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20")}>
                {automation.status === "active" ? <Play size={9} /> : <Pause size={9} />}
                {automation.status === "active" ? "Ativo" : "Pausado"}
              </button>
              <button onClick={() => onEdit(automation)} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-muted)" }}><Pencil size={12} /></button>
              <button onClick={() => onDelete(automation.id)} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-red-500/10 hover:text-red-400" style={{ color: "var(--text-muted)" }}><Trash2 size={12} /></button>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <CalendarClock size={11} style={{ color: "var(--text-muted)" }} />
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{FREQUENCY_LABELS[automation.frequency]}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock size={11} style={{ color: "var(--text-muted)" }} />
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Última: {timeAgo(automation.last_run_at)}</span>
            </div>
            {workflow && (
              <span className="text-[11px] px-2 py-0.5 rounded font-medium" style={{ background: `${workflow.areaColor}15`, color: workflow.areaColor }}>{workflow.name}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-2 mt-4 pt-4 border-t" style={{ borderColor: "var(--border-color)" }}>
        <button onClick={() => onViewLogs(automation.id)} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]" style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
          <History size={12} /> Histórico
        </button>
        <button disabled={running || automation.status === "paused"} onClick={() => { startRun(() => {}); onRun(automation.id) }}
          className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors disabled:opacity-50 ml-auto">
          {running ? <><Loader2 size={12} className="animate-spin" /> Executando</> : <><Play size={12} /> Executar agora</>}
        </button>
      </div>
    </motion.div>
  )
}

// ─── Watcher card ─────────────────────────────────────────────────────────────

function WatcherCard({
  watcher, company, onEdit, onDelete, onToggle, onRun, onViewLogs,
}: {
  watcher:    WatcherRow
  company?:   { name: string; color: string }
  onEdit:     (w: WatcherRow) => void
  onDelete:   (id: string) => void
  onToggle:   (id: string, s: "active" | "paused") => void
  onRun:      (id: string) => Promise<void>
  onViewLogs: (id: string) => void
}) {
  const info         = WATCHER_TYPE_INFO[watcher.watcher_type] ?? { label: watcher.watcher_type, icon: AlertTriangle, color: "#64748b" }
  const Icon         = info.icon
  const [running, setRunning] = useState(false)

  const lastStatus   = watcher.last_result?.status
  const resultColor  = lastStatus ? watcherStatusColor(lastStatus) : null

  return (
    <motion.div layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }}
      className="rounded-2xl border p-5" style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${info.color}15` }}>
          <Icon size={18} style={{ color: info.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{watcher.name}</p>
              {watcher.description && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--text-secondary)" }}>{watcher.description}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => onToggle(watcher.id, watcher.status === "active" ? "paused" : "active")}
                className={cn("flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors",
                  watcher.status === "active" ? "bg-mota-500/10 text-mota-500 hover:bg-mota-500/20" : "bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20")}>
                {watcher.status === "active" ? <Play size={9} /> : <Pause size={9} />}
                {watcher.status === "active" ? "Ativo" : "Pausado"}
              </button>
              <button onClick={() => onEdit(watcher)} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-muted)" }}><Pencil size={12} /></button>
              <button onClick={() => onDelete(watcher.id)} className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-red-500/10 hover:text-red-400" style={{ color: "var(--text-muted)" }}><Trash2 size={12} /></button>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium border"
              style={{ borderColor: `${company?.color ?? "#64748b"}40`, background: `${company?.color ?? "#64748b"}12`, color: company?.color ?? "var(--text-muted)" }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: company?.color ?? "#64748b" }} />
              {company?.name ?? watcher.company_id}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${info.color}15`, color: info.color }}>{info.label}</span>
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{WATCHER_FREQ_LABELS[watcher.frequency] ?? watcher.frequency}</span>
            <div className="flex items-center gap-1.5">
              <Clock size={11} style={{ color: "var(--text-muted)" }} />
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Último check: {timeAgo(watcher.last_check_at)}</span>
            </div>
          </div>

          {watcher.last_result && resultColor && (
            <div className="flex items-center gap-2 mt-2 p-2 rounded-lg" style={{ background: `${resultColor}0d`, border: `1px solid ${resultColor}25` }}>
              <span style={{ color: resultColor, flexShrink: 0 }}><WatcherStatusIcon status={watcher.last_result.status} size={12} /></span>
              <p className="text-[11px] font-medium" style={{ color: resultColor }}>{watcher.last_result.message}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 mt-4 pt-4 border-t" style={{ borderColor: "var(--border-color)" }}>
        <button onClick={() => onViewLogs(watcher.id)} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]" style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
          <History size={12} /> Histórico
        </button>
        <button disabled={running || !watcher.enabled || watcher.status === "paused"}
          onClick={async () => { setRunning(true); await onRun(watcher.id); setRunning(false) }}
          className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors disabled:opacity-50 ml-auto">
          {running ? <><Loader2 size={12} className="animate-spin" /> Verificando</> : <><Bell size={12} /> Verificar agora</>}
        </button>
      </div>
    </motion.div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AutomationsClient({
  automations: initialAutomations,
  watchers:    initialWatchers,
}: {
  automations: AutomationRow[]
  watchers:    WatcherRow[]
}) {
  const { currentCompany, allowedCompanies } = useCompany()

  const [tab,           setTab]           = useState<Tab>("skills")
  const [automations,   setAutomations]   = useState<AutomationRow[]>(initialAutomations)
  const [watchers,      setWatchers]      = useState<WatcherRow[]>(initialWatchers)
  const [watchersLoading, setWatchersLoading] = useState(false)

  // Automation modal state
  const [autoModalMode,  setAutoModalMode]  = useState<"create" | "edit" | null>(null)
  const [autoEditTarget, setAutoEditTarget] = useState<AutomationRow | null>(null)

  // Watcher modal state
  const [watchModalMode,  setWatchModalMode]  = useState<"create" | "edit" | null>(null)
  const [watchEditTarget, setWatchEditTarget] = useState<WatcherRow | null>(null)

  // Panels
  const [autoLogsId,  setAutoLogsId]  = useState<string | null>(null)
  const [watchLogsId, setWatchLogsId] = useState<string | null>(null)
  const [runOutput,   setRunOutput]   = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null)
  const [runError,    setRunError]    = useState<string | null>(null)

  // Load watchers whenever company changes
  const loadWatchers = useCallback(async () => {
    if (!currentCompany) return
    setWatchersLoading(true)
    try {
      const res  = await fetch(`/api/watchers?company_id=${encodeURIComponent(currentCompany.slug)}`)
      const data = await res.json() as WatcherRow[]
      setWatchers(Array.isArray(data) ? data : [])
    } catch {
      // silent
    } finally {
      setWatchersLoading(false)
    }
  }, [currentCompany])

  useEffect(() => { loadWatchers() }, [loadWatchers])

  const defaultCompanyId = currentCompany?.slug ?? allowedCompanies[0]?.slug ?? "grupo"
  const companyBySlug = useMemo(
    () => Object.fromEntries(allowedCompanies.map((c) => [c.slug, c])),
    [allowedCompanies],
  )

  // Stats
  const activeSkills   = skills.filter((s) => s.status === "active").length
  const activeAutos    = automations.filter((a) => a.status === "active").length
  const activeWatchers = watchers.filter((w) => w.status === "active" && w.enabled).length
  const totalTriggers  = watchers.reduce((sum, w) => sum + (w.triggers_count ?? 0), 0)

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "skills",      label: "Skills",     icon: Zap          },
    { id: "automations", label: "Automações", icon: CalendarClock },
    { id: "watchers",    label: "Vigias",     icon: Eye          },
  ]

  // ─── Automation CRUD ──────────────────────────────────────────────────────

  async function saveAutomation(data: Partial<AutomationRow>) {
    if (autoModalMode === "create") {
      const res = await fetch("/api/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      const row = await res.json() as AutomationRow
      if (res.ok) setAutomations((p) => [row, ...p])
    } else if (autoEditTarget) {
      const res = await fetch(`/api/automations/${autoEditTarget.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      const row = await res.json() as AutomationRow
      if (res.ok) setAutomations((p) => p.map((a) => a.id === autoEditTarget.id ? row : a))
    }
    setAutoModalMode(null); setAutoEditTarget(null)
  }

  async function deleteAutomation(id: string) {
    if (!confirm("Excluir esta automação?")) return
    const res = await fetch(`/api/automations/${id}`, { method: "DELETE" })
    if (res.ok) setAutomations((p) => p.filter((a) => a.id !== id))
  }

  async function toggleAutomation(id: string, status: "active" | "paused") {
    const res = await fetch(`/api/automations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) })
    const row = await res.json() as AutomationRow
    if (res.ok) setAutomations((p) => p.map((a) => a.id === id ? row : a))
  }

  async function runAutomation(id: string) {
    const res  = await fetch(`/api/automations/${id}/run`, { method: "POST" })
    const body = await res.json() as { output?: string; error?: string; next_run_at?: string }
    if (!res.ok) { setRunError(body.error ?? "Erro na execução"); return }
    setAutomations((p) => p.map((a) => a.id === id ? { ...a, last_run_at: new Date().toISOString(), next_run_at: body.next_run_at ?? null } : a))
    if (body.output) setRunOutput(body.output)
  }

  // ─── Watcher CRUD ─────────────────────────────────────────────────────────

  async function saveWatcher(data: Partial<WatcherRow>) {
    if (watchModalMode === "create") {
      const res = await fetch("/api/watchers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      const row = await res.json() as WatcherRow & { error?: string }
      if (!res.ok) { setRunError(row.error ?? "Erro ao criar vigia"); return }
      setWatchers((p) => [row, ...p])
    } else if (watchEditTarget) {
      const res = await fetch(`/api/watchers/${watchEditTarget.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      const row = await res.json() as WatcherRow & { error?: string }
      if (!res.ok) { setRunError(row.error ?? "Erro ao salvar vigia"); return }
      setWatchers((p) => p.map((w) => w.id === watchEditTarget.id ? row : w))
    }
    setWatchModalMode(null); setWatchEditTarget(null)
  }

  async function deleteWatcher(id: string) {
    if (!confirm("Excluir este vigia?")) return
    const res = await fetch(`/api/watchers/${id}`, { method: "DELETE" })
    if (res.ok) setWatchers((p) => p.filter((w) => w.id !== id))
  }

  async function toggleWatcher(id: string, status: "active" | "paused") {
    const res = await fetch(`/api/watchers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) })
    const row = await res.json() as WatcherRow
    if (res.ok) setWatchers((p) => p.map((w) => w.id === id ? row : w))
  }

  async function runWatcher(id: string) {
    const res  = await fetch(`/api/watchers/${id}/run`, { method: "POST" })
    const body = await res.json() as CheckResult & { error?: string; log_id?: string }
    if (!res.ok) { setRunError(body.error ?? "Erro na verificação"); return }
    setWatchers((p) => p.map((w) => w.id === id
      ? { ...w, last_check_at: new Date().toISOString(), last_result: { status: body.status, message: body.message, triggered: body.triggered } }
      : w
    ))
    setCheckResult(body)
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        <PageHeader
          title="Automações"
          subtitle={`${activeSkills} skills · ${activeAutos} automações · ${activeWatchers} vigias ativos`}
          actions={
            tab === "automations" ? (
              <button onClick={() => { setAutoEditTarget(null); setAutoModalMode("create") }}
                className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors">
                <Plus size={13} /> Nova automação
              </button>
            ) : tab === "watchers" ? (
              <button onClick={() => { setWatchEditTarget(null); setWatchModalMode("create") }}
                className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors">
                <Plus size={13} /> Novo vigia
              </button>
            ) : null
          }
        />

        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-screen-xl mx-auto space-y-5">

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Skills ativas",       value: activeSkills,   color: "#16a34a" },
                { label: "Automações ativas",    value: activeAutos,    color: "#3b82f6" },
                { label: "Vigias ativos",        value: activeWatchers, color: "#f59e0b" },
                { label: "Alertas disparados",   value: totalTriggers,  color: "#8b5cf6" },
              ].map((stat) => (
                <motion.div key={stat.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl p-4 border" style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
                  <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{stat.label}</p>
                </motion.div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 p-1 rounded-xl border w-fit" style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
              {tabs.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all",
                    tab === t.id ? "bg-mota-600 text-white" : "hover:bg-[var(--bg-hover)]")}
                  style={{ color: tab === t.id ? undefined : "var(--text-secondary)" }}>
                  <t.icon size={13} />{t.label}
                </button>
              ))}
            </div>

            {/* ── Skills ────────────────────────────────────────────────────── */}
            {tab === "skills" && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {skills.map((skill, i) => {
                  const Icon = iconMap[skill.icon] ?? Zap
                  return (
                    <motion.div key={skill.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: i * 0.04 }}
                      className="rounded-2xl border flex flex-col overflow-hidden" style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}>
                      <div className="p-5 flex flex-col gap-3 flex-1">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${skill.color}15` }}>
                            <Icon size={18} style={{ color: skill.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${skill.color}15`, color: skill.color }}>{skill.category}</span>
                              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", skill.status === "active" ? "bg-mota-500/10 text-mota-500" : "bg-yellow-500/10 text-yellow-400")}>
                                {skill.status === "active" ? "Ativo" : "Pausado"}
                              </span>
                            </div>
                            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{skill.name}</p>
                          </div>
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{skill.description}</p>
                        <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
                          <span>{skill.usageCount}× usada</span><span>·</span><span>última: {skill.lastUsed}</span>
                        </div>
                      </div>
                      <div className="px-5 py-3 border-t" style={{ borderColor: "var(--border-color)" }}>
                        <button className="w-full flex items-center justify-center gap-2 text-xs font-semibold py-2.5 rounded-xl text-white transition-all" style={{ background: skill.color }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.88" }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1" }}>
                          <Play size={12} /> Executar skill
                        </button>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}

            {/* ── Automations ───────────────────────────────────────────────── */}
            {tab === "automations" && (
              <AnimatePresence mode="popLayout">
                {automations.length === 0 ? (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16 gap-3">
                    <CalendarClock size={32} style={{ color: "var(--text-muted)" }} />
                    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Nenhuma automação criada ainda</p>
                    <button onClick={() => { setAutoEditTarget(null); setAutoModalMode("create") }}
                      className="flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors mt-1">
                      <Plus size={13} /> Criar primeira automação
                    </button>
                  </motion.div>
                ) : (
                  <div className="space-y-3">
                    {automations.map((a) => (
                      <AutomationCard key={a.id} automation={a}
                        onEdit={(row) => { setAutoEditTarget(row); setAutoModalMode("edit") }}
                        onDelete={deleteAutomation}
                        onToggle={toggleAutomation}
                        onRun={runAutomation}
                        onViewLogs={(id) => setAutoLogsId(id)} />
                    ))}
                  </div>
                )}
              </AnimatePresence>
            )}

            {/* ── Watchers ──────────────────────────────────────────────────── */}
            {tab === "watchers" && (
              <AnimatePresence mode="popLayout">
                {watchersLoading ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center py-16">
                    <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                  </motion.div>
                ) : watchers.length === 0 ? (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16 gap-3">
                    <Eye size={32} style={{ color: "var(--text-muted)" }} />
                    <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Nenhum vigia configurado ainda</p>
                    <button onClick={() => { setWatchEditTarget(null); setWatchModalMode("create") }}
                      className="flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors mt-1">
                      <Plus size={13} /> Criar primeiro vigia
                    </button>
                  </motion.div>
                ) : (
                  <div className="space-y-3">
                    {watchers.map((w) => (
                      <WatcherCard key={w.id} watcher={w}
                        company={companyBySlug[w.company_id]}
                        onEdit={(row) => { setWatchEditTarget(row); setWatchModalMode("edit") }}
                        onDelete={deleteWatcher}
                        onToggle={toggleWatcher}
                        onRun={runWatcher}
                        onViewLogs={(id) => setWatchLogsId(id)} />
                    ))}
                  </div>
                )}
              </AnimatePresence>
            )}

          </div>
        </div>
      </div>

      {/* ── Overlays ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {(autoModalMode === "create" || autoModalMode === "edit") && (
          <AutomationModal key="auto-modal" mode={autoModalMode} initial={autoEditTarget ?? undefined}
            onClose={() => { setAutoModalMode(null); setAutoEditTarget(null) }}
            onSave={saveAutomation}
            allowedCompanies={allowedCompanies}
            defaultCompanyId={defaultCompanyId} />
        )}
        {(watchModalMode === "create" || watchModalMode === "edit") && (
          <WatcherModal key="watch-modal" mode={watchModalMode} initial={watchEditTarget ?? undefined}
            onClose={() => { setWatchModalMode(null); setWatchEditTarget(null) }}
            onSave={saveWatcher}
            allowedCompanies={allowedCompanies}
            defaultCompanyId={defaultCompanyId} />
        )}
        {autoLogsId   && <AutoLogsPanel    key="auto-logs"    automationId={autoLogsId}  onClose={() => setAutoLogsId(null)}  />}
        {watchLogsId  && <WatcherLogsPanel key="watch-logs"   watcherId={watchLogsId}   onClose={() => setWatchLogsId(null)} />}
        {runOutput    && <RunOutputPanel    key="run-output"   output={runOutput}         onClose={() => setRunOutput(null)}   />}
        {checkResult  && <CheckResultPanel  key="check-result" result={checkResult}       onClose={() => setCheckResult(null)} />}
      </AnimatePresence>

      {/* ── Error toast ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {runError && (
          <motion.div key="toast" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl"
            style={{ background: "var(--bg-card)", borderColor: "rgba(239,68,68,0.3)" }}>
            <XCircle size={15} className="text-red-400 shrink-0" />
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{runError}</p>
            <button onClick={() => setRunError(null)} className="ml-2" style={{ color: "var(--text-muted)" }}><X size={13} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
