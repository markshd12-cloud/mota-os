import { NextRequest, NextResponse } from 'next/server'
import { createClient }      from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { getAllowedCompanyIds, isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'
import { runWatcher } from '@/lib/watchers/run-watcher'

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

  void logActivity({
    userId:    user.id,
    eventType: 'watcher',
    action:    'watcher_run_started',
    detail:    `Execução manual do vigia "${watcher.name}"`,
    companyId: watcher.company_id,
    metadata:  { watcher_id: id },
  })

  let result
  try {
    result = await runWatcher(admin, watcher)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao executar vigia' },
      { status: 500 },
    )
  }

  const { logId, check, notify } = result

  void logActivity({
    userId:    user.id,
    eventType: 'watcher',
    action:    check.status === 'error' ? 'watcher_run_failed' : 'watcher_run_finished',
    detail:    check.message,
    companyId: watcher.company_id,
    metadata:  {
      watcher_id: id, log_id: logId, status: check.status,
      matched_count: check.matched_count, notified: notify?.sent ?? false,
    },
  })

  return NextResponse.json({
    ok:            true,
    log_id:        logId,
    status:        check.status,
    message:       check.message,
    triggered:     check.triggered,
    matched_count: check.matched_count,
    result:        check.result_data,
    error_message: check.error_message,
    notification:  notify,
  })
}
