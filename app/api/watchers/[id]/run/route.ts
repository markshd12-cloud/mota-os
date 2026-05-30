import { NextRequest, NextResponse } from 'next/server'
import { createClient }      from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { getAllowedCompanyIds, isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'
import { evaluateWatcher, type WatcherType } from '@/lib/watchers/evaluate-watcher'
import { calcNextRunAt, type WatcherFrequency } from '@/lib/watchers/schedule'

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = createAdminClient()

  // Buscar vigia e verificar acesso
  const { data: watcher, error: wErr } = await admin
    .from('watchers')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (wErr || !watcher) {
    return NextResponse.json({ error: 'Vigia não encontrado' }, { status: 404 })
  }

  const isAdmin = await isGlobalAdmin(user.id)
  if (!isAdmin) {
    const allowed = await getAllowedCompanyIds(user.id)
    if (!allowed.includes(watcher.company_id)) {
      return NextResponse.json({ error: 'Sem acesso a este vigia' }, { status: 403 })
    }
  }

  if (!watcher.enabled || watcher.status === 'paused') {
    return NextResponse.json({ error: 'Vigia está desativado ou pausado' }, { status: 400 })
  }

  // Criar log com status 'running'
  const { data: logRow, error: logErr } = await admin
    .from('watcher_logs')
    .insert({
      watcher_id:    id,
      company_id:    watcher.company_id,
      status:        'running',
      message:       '',
      result:        {},
      result_data:   {},
      matched_count: 0,
      triggered:     false,
    })
    .select('id')
    .single()

  if (logErr || !logRow) {
    return NextResponse.json({ error: 'Erro ao criar log de execução' }, { status: 500 })
  }

  void logActivity({
    userId:    user.id,
    eventType: 'watcher',
    action:    'watcher_run_started',
    detail:    `Execução manual do vigia "${watcher.name}"`,
    companyId: watcher.company_id,
    metadata:  { watcher_id: id, log_id: logRow.id },
  })

  // Executar avaliação
  const condition = (watcher.condition_config ?? watcher.condition ?? {}) as Record<string, unknown>
  const check = await evaluateWatcher(
    watcher.watcher_type as WatcherType,
    condition,
    watcher.company_id,
    admin,
  )

  const finishedAt = new Date().toISOString()

  // Mapear status para schema legado (watcher_logs aceita: running/ok/alert/error/success/warning/failed)
  // 'warning' é novo — mantemos; 'ok' e 'alert' já existiam
  const logStatus: 'ok' | 'alert' | 'error' | 'warning' =
    check.status === 'ok'    ? 'ok'
    : check.status === 'alert'   ? 'alert'
    : check.status === 'warning' ? 'warning'
    : 'error'

  const nextRunAt = calcNextRunAt({
    frequency:    watcher.frequency as WatcherFrequency,
    scheduleTime: watcher.schedule_time,
    timezone:     watcher.timezone,
    daysOfWeek:   watcher.days_of_week,
  })

  await Promise.all([
    admin.from('watcher_logs').update({
      status:        logStatus,
      message:       check.message,
      result:        check.result_data,
      result_data:   check.result_data,
      triggered:     check.triggered,
      matched_count: check.matched_count,
      error_message: check.error_message,
      finished_at:   finishedAt,
    }).eq('id', logRow.id),

    admin.from('watchers').update({
      last_check_at:  finishedAt,
      next_check_at:  nextRunAt,
      last_result:    {
        status:    check.status,
        message:   check.message,
        triggered: check.triggered,
      },
      triggers_count: (watcher.triggers_count ?? 0) + (check.triggered ? 1 : 0),
    }).eq('id', id),
  ])

  void logActivity({
    userId:    user.id,
    eventType: 'watcher',
    action:    check.status === 'error' ? 'watcher_run_failed' : 'watcher_run_finished',
    detail:    check.message,
    companyId: watcher.company_id,
    metadata:  { watcher_id: id, log_id: logRow.id, status: check.status, matched_count: check.matched_count },
  })

  return NextResponse.json({
    ok:            true,
    log_id:        logRow.id,
    status:        check.status,
    message:       check.message,
    triggered:     check.triggered,
    matched_count: check.matched_count,
    result:        check.result_data,
    error_message: check.error_message,
  })
}
