/**
 * Lógica de avaliação de cada tipo de vigia. SERVER-SIDE ONLY.
 * Retorna sempre CheckResult sem lançar exceções — erros viram status "error".
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type CheckResult = {
  status:        'ok' | 'alert' | 'warning' | 'error'
  message:       string
  triggered:     boolean
  matched_count: number
  result_data:   Record<string, unknown>
  error_message: string | null
}

type Cond = Record<string, unknown>

function ok(message: string, data: Record<string, unknown> = {}): CheckResult {
  return { status: 'ok', message, triggered: false, matched_count: 0, result_data: data, error_message: null }
}
function alert(message: string, count: number, data: Record<string, unknown> = {}): CheckResult {
  return { status: 'alert', message, triggered: true, matched_count: count, result_data: data, error_message: null }
}
function warning(message: string, data: Record<string, unknown> = {}): CheckResult {
  return { status: 'warning', message, triggered: false, matched_count: 0, result_data: data, error_message: null }
}
function errResult(msg: string): CheckResult {
  return { status: 'error', message: msg, triggered: false, matched_count: 0, result_data: {}, error_message: msg }
}

// ─── Tipos suportados ─────────────────────────────────────────────────────────

export type WatcherType =
  // Novos (spec F.1)
  | 'overdue_tasks'
  | 'sessions_without_response'
  | 'workflow_errors'
  | 'automation_errors'
  | 'high_cpl'
  | 'campaign_without_leads'
  | 'inactive_agent'
  | 'failed_api_connection'
  | 'project_deadline_risk'
  // Legados (backwards compat)
  | 'sessions_no_ai'
  | 'workflow_not_run'
  | 'automation_error'
  | 'cpl_above_limit'
  | 'campaign_no_leads'

export async function evaluateWatcher(
  type:      WatcherType,
  condition: Cond,
  companyId: string,
  admin:     SupabaseClient,
): Promise<CheckResult> {
  try {
    return await dispatch(type, condition, companyId, admin)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro inesperado'
    return errResult(msg)
  }
}

async function dispatch(
  type:      WatcherType,
  condition: Cond,
  companyId: string,
  admin:     SupabaseClient,
): Promise<CheckResult> {
  switch (type) {

    // ── Tarefas atrasadas ──────────────────────────────────────────────────────
    case 'overdue_tasks': {
      const today = new Date().toISOString().split('T')[0]
      let q = admin
        .from('tasks')
        .select('id, title, due_date, status, priority')
        .lt('due_date', today)
        .neq('status', 'done')

      if (condition.company_id) q = q.eq('company_id', String(condition.company_id))
      else if (companyId)       q = q.eq('company_id', companyId)

      const { data, error } = await q.limit(50)
      if (error) return errResult(error.message)

      const count = data?.length ?? 0
      if (count === 0) return ok('Nenhuma tarefa atrasada')
      return alert(`${count} tarefa${count > 1 ? 's' : ''} com prazo vencido`, count, {
        tasks: data?.slice(0, 10) ?? [],
      })
    }

    // ── Sessões sem resposta ───────────────────────────────────────────────────
    case 'sessions_without_response':
    case 'sessions_no_ai': {
      const hours   = Number(condition.threshold_hours ?? condition.minutes_divided ?? condition.hours ?? 2)
      const minutes = type === 'sessions_no_ai'
        ? Number(condition.minutes ?? hours * 60)
        : hours * 60
      const since = new Date(Date.now() - minutes * 60_000).toISOString()

      const { data: sessions, error } = await admin
        .from('sessions')
        .select('id, title, last_message_at')
        .eq('company_id', companyId)
        .gte('last_message_at', since)
        .order('last_message_at', { ascending: false })
        .limit(30)

      if (error) return errResult(error.message)

      const pending: { id: string; title: string; last_message_at: string }[] = []
      for (const s of sessions ?? []) {
        const { data: msgs } = await admin
          .from('messages')
          .select('role')
          .eq('session_id', s.id)
          .order('created_at', { ascending: false })
          .limit(1)
        if (msgs?.[0]?.role === 'user') pending.push(s)
      }

      if (pending.length === 0) return ok('Todas as sessões têm resposta da IA')
      return alert(
        `${pending.length} sessão${pending.length > 1 ? 'ões' : ''} aguardando resposta da IA`,
        pending.length,
        { sessions: pending },
      )
    }

    // ── Erros de workflow ──────────────────────────────────────────────────────
    case 'workflow_errors':
    case 'workflow_not_run': {
      if (type === 'workflow_not_run') {
        // Lógica legada: checar se workflow rodou nas últimas N horas
        const hours = Number(condition.hours ?? 24)
        const since = new Date(Date.now() - hours * 3_600_000).toISOString()
        let q = admin
          .from('workflow_runs')
          .select('id, workflow_name, created_at')
          .gte('created_at', since)
          .eq('status', 'done')
        if (condition.workflow_slug) q = q.eq('workflow_slug', String(condition.workflow_slug))
        const { data, error } = await q.limit(1)
        if (error) return errResult(error.message)
        const ran = (data?.length ?? 0) > 0
        return ran
          ? ok(`Workflow executado nas últimas ${hours}h`)
          : alert(`Workflow não executado nas últimas ${hours}h`, 1, { hours })
      }

      // Novo: contar falhas de workflow nas últimas N horas
      const hours = Number(condition.lookback_hours ?? condition.hours ?? 24)
      const since = new Date(Date.now() - hours * 3_600_000).toISOString()
      // A execução de workflow grava status 'error'; 'failed' é aceito por
      // compatibilidade com o check constraint (ambos representam falha).
      const { data, error } = await admin
        .from('workflow_runs')
        .select('id, workflow_name, created_at, error_message')
        .in('status', ['error', 'failed'])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) return warning('Tabela workflow_runs não encontrada ou sem dados.')
      const count = data?.length ?? 0
      if (count === 0) return ok(`Nenhuma falha de workflow nas últimas ${hours}h`)
      return alert(`${count} falha${count > 1 ? 's' : ''} de workflow nas últimas ${hours}h`, count, {
        errors: data?.slice(0, 10) ?? [], hours,
      })
    }

    // ── Erros de automação ─────────────────────────────────────────────────────
    case 'automation_errors':
    case 'automation_error': {
      const hours = Number(condition.lookback_hours ?? condition.hours ?? 24)
      const since = new Date(Date.now() - hours * 3_600_000).toISOString()
      const { data, error } = await admin
        .from('automation_runs')
        .select('id, automation_id, error_message, started_at')
        .eq('status', 'error')
        .gte('started_at', since)
        .order('started_at', { ascending: false })
        .limit(10)

      if (error) return warning('Tabela automation_runs não encontrada ou sem dados.')
      const count = data?.length ?? 0
      if (count === 0) return ok(`Nenhuma automação com erro nas últimas ${hours}h`)
      return alert(
        `${count} automação${count > 1 ? 'ões' : ''} com erro nas últimas ${hours}h`,
        count,
        { errors: data ?? [], hours },
      )
    }

    // ── CPL alto ──────────────────────────────────────────────────────────────
    case 'high_cpl':
    case 'cpl_above_limit': {
      const limit   = Number(condition.threshold ?? condition.limit ?? 0)
      const current = Number(condition.current_cpl ?? 0)
      if (limit === 0) return errResult('Defina o limite de CPL na condição do vigia.')
      const above = current > limit
      if (!above) return ok(`CPL R$${current.toFixed(2)} dentro do limite R$${limit.toFixed(2)}`)
      return alert(
        `CPL R$${current.toFixed(2)} acima do limite R$${limit.toFixed(2)}`,
        1,
        { current_cpl: current, limit, campaign: condition.campaign ?? '' },
      )
    }

    // ── Campanha sem leads ────────────────────────────────────────────────────
    case 'campaign_without_leads':
    case 'campaign_no_leads': {
      const expected = Number(condition.expected_leads ?? 0)
      const current  = Number(condition.current_leads  ?? 0)
      if (expected === 0) return errResult('Defina a meta de leads na condição do vigia.')
      if (current >= expected) return ok(`${current} leads — meta atingida (${expected})`)
      return alert(
        `${current} lead${current !== 1 ? 's' : ''} — abaixo da meta de ${expected}`,
        1,
        { current_leads: current, expected_leads: expected, campaign: condition.campaign ?? '' },
      )
    }

    // ── Agente inativo ────────────────────────────────────────────────────────
    case 'inactive_agent': {
      const days = Number(condition.days ?? 7)
      const since = new Date(Date.now() - days * 86_400_000).toISOString()

      // Resolve agents for this company via agent_companies junction table
      const { data: acRows } = await admin
        .from('agent_companies')
        .select('agent_id')
        .eq('company_id', companyId)
        .eq('status', 'active')

      const agentIds = (acRows ?? []).map(r => r.agent_id as string)
      if (!agentIds.length) return ok('Nenhum agente vinculado a esta empresa.')

      const { data: agents, error } = await admin
        .from('agents')
        .select('id, name, status')
        .in('id', agentIds)
        .eq('status', 'active')

      if (error) return warning('Tabela agents não encontrada ou sem dados.')
      if (!agents?.length) return ok('Nenhum agente ativo encontrado.')

      const inactive: { id: string; name: string; last_session: string | null }[] = []
      for (const a of agents) {
        const { data: sess } = await admin
          .from('sessions')
          .select('created_at')
          .eq('agent_id', a.id)
          .gte('created_at', since)
          .limit(1)
        if (!sess?.length) {
          inactive.push({ id: a.id, name: a.name, last_session: null })
        }
      }

      if (!inactive.length) return ok(`Todos os agentes tiveram sessões nos últimos ${days} dias`)
      return alert(
        `${inactive.length} agente${inactive.length > 1 ? 's' : ''} sem uso nos últimos ${days} dias`,
        inactive.length,
        { agents: inactive, days },
      )
    }

    // ── Falha de conexão de API ───────────────────────────────────────────────
    case 'failed_api_connection': {
      const { data, error } = await admin
        .from('api_connections')
        .select('id, name, status, last_error, last_checked_at')
        .eq('status', 'error')
        .limit(20)

      if (error) return warning('Tabela api_connections não encontrada. Configure suas conexões de API.')
      if (!data?.length) return ok('Todas as conexões de API estão funcionando.')
      return alert(
        `${data.length} conexão${data.length > 1 ? 'ões' : ''} de API com erro`,
        data.length,
        { connections: data },
      )
    }

    // ── Risco de prazo de projeto ─────────────────────────────────────────────
    case 'project_deadline_risk': {
      const daysBefore = Number(condition.days_before_due ?? condition.days ?? 7)
      const threshold  = new Date(Date.now() + daysBefore * 86_400_000).toISOString().split('T')[0]
      const today      = new Date().toISOString().split('T')[0]

      let q = admin
        .from('projects')
        .select('id, name, due_date, status')
        .lte('due_date', threshold)
        .gte('due_date', today)
        .not('status', 'in', '("completed","archived","done")')

      if (companyId) q = q.eq('company_id', companyId)

      const { data, error } = await q.limit(20)
      if (error) return warning('Tabela projects não encontrada ou sem dados.')
      if (!data?.length) return ok(`Nenhum projeto com prazo nos próximos ${daysBefore} dias`)
      return alert(
        `${data.length} projeto${data.length > 1 ? 's' : ''} com prazo nos próximos ${daysBefore} dias`,
        data.length,
        { projects: data, days_before_due: daysBefore },
      )
    }

    default:
      return errResult(`Tipo de vigia desconhecido: ${type}`)
  }
}
