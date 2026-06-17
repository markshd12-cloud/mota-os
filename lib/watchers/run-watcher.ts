/**
 * Execução de um vigia (avaliação + persistência + notificação). SERVER-SIDE ONLY.
 * Compartilhado entre a execução manual (rota /run) e o cron (/api/cron/watchers).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateWatcher, type WatcherType, type CheckResult } from './evaluate-watcher'
import { calcNextRunAt, type WatcherFrequency } from './schedule'
import { notifyWatcher, type NotifyResult } from './notify'

export type WatcherRecord = {
  id:                    string
  name:                  string
  company_id:            string
  watcher_type:          string
  condition:             Record<string, unknown> | null
  condition_config:      Record<string, unknown> | null
  frequency:             string
  schedule_time:         string | null
  timezone:              string | null
  days_of_week:          string[] | null
  triggers_count:        number | null
  notification_channel?: string | null
  notification_config?:  Record<string, unknown> | null
}

export type RunWatcherResult = {
  logId:  string
  check:  CheckResult
  notify: NotifyResult | null
}

export async function runWatcher(
  admin:   SupabaseClient,
  watcher: WatcherRecord,
): Promise<RunWatcherResult> {
  // 1. Log com status 'running'
  const { data: logRow, error: logErr } = await admin
    .from('watcher_logs')
    .insert({
      watcher_id:    watcher.id,
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

  if (logErr || !logRow) throw new Error('Erro ao criar log de execução')

  // 2. Avaliar
  const condition = (watcher.condition_config ?? watcher.condition ?? {}) as Record<string, unknown>
  const check = await evaluateWatcher(
    watcher.watcher_type as WatcherType,
    condition,
    watcher.company_id,
    admin,
  )

  const finishedAt = new Date().toISOString()

  const logStatus: 'ok' | 'alert' | 'error' | 'warning' =
    check.status === 'ok'        ? 'ok'
    : check.status === 'alert'   ? 'alert'
    : check.status === 'warning' ? 'warning'
    : 'error'

  const nextRunAt = calcNextRunAt({
    frequency:    watcher.frequency as WatcherFrequency,
    scheduleTime: watcher.schedule_time,
    timezone:     watcher.timezone,
    daysOfWeek:   watcher.days_of_week,
  })

  // 3. Persistir resultado (log + watcher) antes de notificar
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
    }).eq('id', watcher.id),
  ])

  // 4. Notificar quando disparado
  const notify = check.triggered ? await notifyWatcher(admin, watcher, check) : null

  return { logId: logRow.id, check, notify }
}
