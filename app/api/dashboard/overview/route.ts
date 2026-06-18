import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import {
  getCurrentCompany,
  assertCanAccessCompany,
  isGlobalAdmin,
  isParentCompany,
  CHILD_SLUGS,
} from "@/lib/company-scope"

export const dynamic = "force-dynamic"

type Period = "today" | "yesterday" | "7d" | "30d" | "month_to_date"

function periodBoundaries(period: Period): { start: string; end: string | null } {
  const now        = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  switch (period) {
    case "today":
      return { start: todayStart.toISOString(), end: null }

    case "yesterday": {
      const yStart = new Date(todayStart)
      yStart.setDate(yStart.getDate() - 1)
      return { start: yStart.toISOString(), end: todayStart.toISOString() }
    }

    case "7d": {
      const d = new Date(todayStart)
      d.setDate(d.getDate() - 6)
      return { start: d.toISOString(), end: null }
    }

    case "30d": {
      const d = new Date(now)
      d.setDate(d.getDate() - 30)
      return { start: d.toISOString(), end: null }
    }

    case "month_to_date": {
      const d = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start: d.toISOString(), end: null }
    }

    default: {
      const d = new Date(todayStart)
      d.setDate(d.getDate() - 6)
      return { start: d.toISOString(), end: null }
    }
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // Dashboard apenas para admin
  const adminUser = await isGlobalAdmin(user.id)
  if (!adminUser) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  }

  const url    = new URL(req.url)
  const period = (url.searchParams.get("period") ?? "7d") as Period
  const admin  = createAdminClient()

  // Resolve company
  let companyId: string
  const reqCompany = url.searchParams.get("company_id")
  if (reqCompany) {
    try { await assertCanAccessCompany(user.id, reqCompany) }
    catch { return NextResponse.json({ error: "Sem acesso à empresa" }, { status: 403 }) }
    companyId = reqCompany
  } else {
    companyId = await getCurrentCompany(user.id)
  }

  // Se for empresa-mãe (grupo): visão consolidada de todas as empresas-filho
  const isConsolidated = isParentCompany(companyId)

  const { start, end } = periodBoundaries(period)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function withPeriod(q: any): any {
    let r = q.gte("created_at", start)
    if (end) r = r.lt("created_at", end)
    return r
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function withCompany(q: any): any {
    if (isConsolidated) return q.in("company_id", CHILD_SLUGS)
    return q.eq("company_id", companyId)
  }

  // Company info para grupo: objeto estático
  const groupCompanyInfo = isConsolidated
    ? { slug: "grupo", name: "Grupo Mota (consolidado)", color: "#10b981", initials: "GM", description: "Visão consolidada de todas as empresas" }
    : null

  // ── Parallel queries ────────────────────────────────────────────────────────
  const [
    singleCompanyResult,

    { count: projectsActive },
    { data: projectsAtRisk },
    { data: projectsTop },

    { count: workflowsRun },
    { count: workflowsError },
    { data: workflowRunsRecent },

    { count: watchersActive },
    { count: alertsRecent },
    { data: watcherLogsRecent },

    { data: agentsAll },

    { count: sessionsCount },
    { data: sessionAgents },

    { data: sourcesAll },
    { count: ragChunks },

    { data: activityLogs },
    { data: snapshotRows },

    { data: metricsRaw },
  ] = await Promise.all([
    // Company info (null for consolidated — use static object above)
    isConsolidated
      ? Promise.resolve({ data: null, error: null })
      : admin.from("companies")
          .select("slug, name, color, initials, description")
          .eq("slug", companyId)
          .single(),

    // Projects active
    withCompany(
      admin.from("projects")
        .select("*", { count: "exact", head: true })
        .in("status", ["planning", "active", "paused"])
        .is("deleted_at", null)
    ),

    // Projects at risk (end_date past + not done)
    withCompany(
      admin.from("projects")
        .select("id, name, status, priority, end_date")
        .in("status", ["planning", "active", "paused"])
        .is("deleted_at", null)
        .not("end_date", "is", null)
        .lte("end_date", new Date().toISOString().slice(0, 10))
    ),

    // Projects top 5
    withCompany(
      admin.from("projects")
        .select("id, name, status, priority, end_date")
        .is("deleted_at", null)
        .not("status", "in", '("archived","completed")')
        .order("created_at", { ascending: false })
        .limit(5)
    ),

    // Workflow runs done in period
    withPeriod(
      withCompany(
        admin.from("workflow_runs")
          .select("*", { count: "exact", head: true })
          .eq("status", "done")
      )
    ),

    // Workflow runs error in period
    withPeriod(
      withCompany(
        admin.from("workflow_runs")
          .select("*", { count: "exact", head: true })
          .eq("status", "error")
      )
    ),

    // Recent workflow runs (done + error)
    withPeriod(
      withCompany(
        admin.from("workflow_runs")
          .select("id, workflow_name, workflow_slug, status, created_at, error_message")
      )
    ).order("created_at", { ascending: false }).limit(8),

    // Watchers enabled
    withCompany(
      admin.from("watchers")
        .select("*", { count: "exact", head: true })
        .eq("enabled", true)
        .is("deleted_at", null)
    ),

    // Watcher alert logs in period
    withPeriod(
      withCompany(
        admin.from("watcher_logs")
          .select("*", { count: "exact", head: true })
          .eq("status", "alert")
      )
    ),

    // Recent watcher logs
    withPeriod(
      withCompany(
        admin.from("watcher_logs")
          .select("id, watcher_id, status, created_at, error_message")
      )
    ).order("created_at", { ascending: false }).limit(5),

    // All active agents
    withCompany(
      admin.from("agents")
        .select("id, name, short_name, color, is_active")
        .eq("is_active", true)
        .eq("kind", "agent")
    ),

    // Sessions count in period
    withPeriod(
      withCompany(
        admin.from("sessions")
          .select("*", { count: "exact", head: true })
      )
    ),

    // Session agent IDs (for per-agent usage)
    withPeriod(
      withCompany(
        admin.from("sessions")
          .select("agent_id")
          .not("agent_id", "is", null)
      )
    ),

    // Knowledge sources
    withCompany(
      admin.from("knowledge_sources")
        .select("id, name, type, embedding_status")
    ),

    // RAG chunks
    withCompany(
      admin.from("knowledge_chunks")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null)
    ),

    // Activity logs
    withPeriod(
      withCompany(
        admin.from("activity_logs")
          .select("id, event_type, action, detail, company_id, created_at")
      )
    ).order("created_at", { ascending: false }).limit(20),

    // Latest snapshot
    withCompany(
      admin.from("dashboard_snapshots")
        .select("id, snapshot_date, period, summary, ai_analysis, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
    ),

    // Marketing metrics
    (() => {
      const startDate = start.slice(0, 10)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = withCompany(
        admin.from("dashboard_metrics")
          .select("metric_name, metric_value, metric_date, source, campaign_name")
          .gte("metric_date", startDate)
      )
      if (end) q = q.lte("metric_date", end.slice(0, 10))
      return q.order("metric_date", { ascending: false })
    })(),
  ])

  // ── Agent usage breakdown ──────────────────────────────────────────────────
  const agentCounts: Record<string, number> = {}
  for (const s of sessionAgents ?? []) {
    if (s.agent_id) agentCounts[s.agent_id] = (agentCounts[s.agent_id] ?? 0) + 1
  }

  type AgentRow = { id: string; name: string; shortName: string | null; color: string | null; sessions: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agents: AgentRow[] = (agentsAll ?? []).map((a: any): AgentRow => ({
    id:        a.id         as string,
    name:      a.name       as string,
    shortName: a.short_name as string | null,
    color:     a.color      as string | null,
    sessions:  agentCounts[a.id] ?? 0,
  })).sort((a: AgentRow, b: AgentRow) => b.sessions - a.sessions)

  // ── Sources breakdown ──────────────────────────────────────────────────────
  const sourceBreakdown = { done: 0, pending: 0, processing: 0, error: 0 }
  for (const s of sourcesAll ?? []) {
    const st = (s.embedding_status ?? "pending") as keyof typeof sourceBreakdown
    if (st in sourceBreakdown) sourceBreakdown[st]++
    else sourceBreakdown.pending++
  }

  // ── Marketing aggregation ──────────────────────────────────────────────────
  const hasMarketing = (metricsRaw ?? []).length > 0
  const marketingTotals: Record<string, number> = {}
  for (const m of metricsRaw ?? []) {
    if (m.metric_value != null) {
      marketingTotals[m.metric_name] = (marketingTotals[m.metric_name] ?? 0) + Number(m.metric_value)
    }
  }

  const company = singleCompanyResult.data ?? groupCompanyInfo

  return NextResponse.json({
    company,
    period,
    kpis: {
      sessions_period:  sessionsCount  ?? 0,
      workflows_run:    workflowsRun   ?? 0,
      workflows_error:  workflowsError ?? 0,
      watchers_active:  watchersActive ?? 0,
      alerts_recent:    alertsRecent   ?? 0,
      sources_indexed:  sourceBreakdown.done,
      agents_active:    (agentsAll ?? []).length,
      rag_chunks:       ragChunks ?? 0,
      projects_active:  projectsActive ?? 0,
      projects_at_risk: (projectsAtRisk ?? []).length,
    },
    projects:        projectsTop       ?? [],
    projects_at_risk: projectsAtRisk   ?? [],
    workflow_runs:   workflowRunsRecent ?? [],
    watcher_logs:    watcherLogsRecent  ?? [],
    agents,
    sources: {
      breakdown: sourceBreakdown,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: (sourcesAll ?? []).map((s: any) => ({
        id:     s.id     as string,
        name:   s.name   as string,
        type:   s.type   as string,
        status: (s.embedding_status ?? "pending") as string,
      })),
    },
    marketing: {
      has_data: hasMarketing,
      totals:   hasMarketing ? marketingTotals : null,
    },
    activity:        activityLogs  ?? [],
    latest_snapshot: snapshotRows?.[0] ?? null,
  })
}
