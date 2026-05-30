import { NextRequest, NextResponse } from 'next/server'
import { createClient }      from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { getAllowedCompanyIds, isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'
import { calcNextRunAt, type WatcherFrequency } from '@/lib/watchers/schedule'

export const dynamic = 'force-dynamic'

const VALID_TYPES = [
  'overdue_tasks', 'sessions_without_response', 'workflow_errors', 'automation_errors',
  'high_cpl', 'campaign_without_leads', 'inactive_agent', 'failed_api_connection',
  'project_deadline_risk',
  // backwards compat
  'sessions_no_ai', 'workflow_not_run', 'automation_error', 'cpl_above_limit', 'campaign_no_leads',
] as const

const VALID_FREQ = ['manual', 'hourly', 'daily', 'weekly', 'monthly'] as const

// ─── GET — listar vigias por empresa ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('company_id')

  const admin   = createAdminClient()
  const isAdmin = await isGlobalAdmin(user.id)

  // Determina quais empresas o usuário pode ver
  let allowedSlugs: string[]
  if (isAdmin) {
    allowedSlugs = companyId ? [companyId] : ['grupo', 'cppem', 'unicive', 'colegio', 'everton']
  } else {
    allowedSlugs = await getAllowedCompanyIds(user.id)
    if (companyId) {
      if (!allowedSlugs.includes(companyId)) {
        return NextResponse.json({ error: 'Sem acesso a esta empresa' }, { status: 403 })
      }
      allowedSlugs = [companyId]
    }
  }

  let query = admin
    .from('watchers')
    .select('*')
    .in('company_id', allowedSlugs)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  const { data, error } = await query
  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// ─── POST — criar vigia ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const body = await req.json() as Record<string, unknown>

  const name       = typeof body.name        === 'string' ? body.name.trim() : ''
  const watcherType = typeof body.watcher_type === 'string' ? body.watcher_type : ''
  const companyId  = typeof body.company_id  === 'string' ? body.company_id  : 'grupo'
  const frequency  = (typeof body.frequency  === 'string' ? body.frequency   : 'manual') as WatcherFrequency

  if (!name)        return NextResponse.json({ error: 'name é obrigatório' },         { status: 400 })
  if (!watcherType) return NextResponse.json({ error: 'watcher_type é obrigatório' }, { status: 400 })
  if (!VALID_TYPES.includes(watcherType as typeof VALID_TYPES[number])) {
    return NextResponse.json({ error: `watcher_type inválido: ${watcherType}` }, { status: 400 })
  }
  if (!VALID_FREQ.includes(frequency as typeof VALID_FREQ[number])) {
    return NextResponse.json({ error: `frequency inválido: ${frequency}` }, { status: 400 })
  }

  // Verificar acesso à empresa
  const isAdmin = await isGlobalAdmin(user.id)
  if (!isAdmin) {
    const allowed = await getAllowedCompanyIds(user.id)
    if (!allowed.includes(companyId as never)) {
      return NextResponse.json({ error: 'Sem acesso a esta empresa' }, { status: 403 })
    }
  }

  const scheduleTime = typeof body.schedule_time === 'string' ? body.schedule_time : null
  const timezone     = typeof body.timezone      === 'string' ? body.timezone      : 'America/Recife'
  const daysOfWeek   = Array.isArray(body.days_of_week) ? body.days_of_week as string[] : null
  const conditionCfg = (body.condition_config && typeof body.condition_config === 'object')
    ? body.condition_config as Record<string, unknown>
    : (body.condition && typeof body.condition === 'object') ? body.condition as Record<string, unknown> : {}

  const nextRunAt = calcNextRunAt({ frequency, scheduleTime, timezone, daysOfWeek })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('watchers')
    .insert({
      name,
      description:          typeof body.description === 'string' ? body.description : '',
      company_id:           companyId,
      watcher_type:         watcherType,
      condition:            conditionCfg,
      condition_config:     conditionCfg,
      frequency,
      schedule_time:        scheduleTime,
      timezone,
      days_of_week:         daysOfWeek,
      enabled:              body.enabled !== false,
      status:               'active',
      notification_channel: typeof body.notification_channel === 'string' ? body.notification_channel : 'dashboard',
      notification_config:  (body.notification_config && typeof body.notification_config === 'object')
        ? body.notification_config : { channel: 'dashboard' },
      next_check_at:        nextRunAt,
      created_by:           user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: 'watcher',
    action:    'watcher_created',
    detail:    `Vigia "${name}" criado`,
    companyId,
    metadata:  { watcher_id: data.id, watcher_type: watcherType, frequency },
  })

  return NextResponse.json(data, { status: 201 })
}
