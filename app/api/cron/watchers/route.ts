import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { logActivity } from '@/lib/activity-logger'
import { runWatcher, type WatcherRecord } from '@/lib/watchers/run-watcher'

export const dynamic = 'force-dynamic'
// Avaliar vários vigias (cada um pode notificar via Rocket.Chat com timeout de 10s)
export const maxDuration = 300

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // Em produção, falha fechado: sem segredo configurado o cron fica inacessível
    // (evita disparo público não autenticado). Em dev, permite para facilitar testes.
    const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
    return !isProd
  }
  const header = req.headers.get('authorization')
  if (header === `Bearer ${secret}`) return true
  // Fallback: ?secret= para disparo manual/testes
  return new URL(req.url).searchParams.get('secret') === secret
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()
  const { data: due, error } = await admin
    .from('watchers')
    .select('*')
    .eq('enabled', true)
    .eq('status', 'active')
    .is('deleted_at', null)
    .not('next_check_at', 'is', null)
    .lte('next_check_at', nowIso)
    .order('next_check_at', { ascending: true })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: 'Erro ao listar vigias' }, { status: 500 })
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, evaluated: 0, ran_at: nowIso })
  }

  let triggered = 0
  let notified  = 0
  let errored   = 0
  const report: Record<string, unknown>[] = []

  for (const watcher of due as WatcherRecord[]) {
    try {
      const { check, notify } = await runWatcher(admin, watcher)
      if (check.triggered)  triggered++
      if (notify?.sent)     notified++
      if (check.status === 'error') errored++

      report.push({
        id:        watcher.id,
        name:      watcher.name,
        status:    check.status,
        triggered: check.triggered,
        notified:  notify?.sent ?? false,
      })

      if (check.triggered) {
        void logActivity({
          eventType: 'watcher',
          action:    'watcher_run_finished',
          detail:    check.message,
          companyId: watcher.company_id,
          metadata:  {
            watcher_id: watcher.id, source: 'cron',
            status: check.status, matched_count: check.matched_count,
            notified: notify?.sent ?? false,
          },
        })
      }
    } catch (e) {
      errored++
      report.push({
        id:    watcher.id,
        name:  watcher.name,
        error: e instanceof Error ? e.message : 'Erro ao executar',
      })
    }
  }

  return NextResponse.json({
    ok:        true,
    evaluated: due.length,
    triggered,
    notified,
    errored,
    ran_at:    nowIso,
    report,
  })
}

export async function GET(req: NextRequest)  { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
