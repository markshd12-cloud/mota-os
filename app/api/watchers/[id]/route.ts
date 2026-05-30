import { NextRequest, NextResponse } from 'next/server'
import { createClient }      from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { getAllowedCompanyIds, isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'
import { calcNextRunAt, type WatcherFrequency } from '@/lib/watchers/schedule'

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

const VALID_FREQ = ['manual', 'hourly', 'daily', 'weekly', 'monthly'] as const

async function fetchWatcher(id: string, userId: string, adminClient: ReturnType<typeof createAdminClient>) {
  const { data: watcher, error } = await adminClient
    .from('watchers')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (error || !watcher) return null

  // Verificar acesso por empresa
  const isAdmin = await isGlobalAdmin(userId)
  if (!isAdmin) {
    const allowed = await getAllowedCompanyIds(userId)
    if (!allowed.includes(watcher.company_id)) return null
  }

  return watcher
}

// ─── GET — detalhes do vigia ─────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin   = createAdminClient()
  const watcher = await fetchWatcher(id, user.id, admin)
  if (!watcher) return NextResponse.json({ error: 'Vigia não encontrado' }, { status: 404 })
  return NextResponse.json(watcher)
}

// ─── PATCH — atualizar vigia ─────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin   = createAdminClient()
  const watcher = await fetchWatcher(id, user.id, admin)
  if (!watcher) return NextResponse.json({ error: 'Vigia não encontrado' }, { status: 404 })

  const body = await req.json() as Record<string, unknown>

  const ALLOWED_FIELDS = [
    'name', 'description', 'status', 'enabled',
    'watcher_type', 'frequency', 'schedule_time', 'timezone', 'days_of_week',
    'condition', 'condition_config', 'notification_channel', 'notification_config',
  ]

  const patch: Record<string, unknown> = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in body) patch[key] = body[key]
  }

  // Sync condition ↔ condition_config
  if ('condition_config' in patch && !('condition' in patch)) patch.condition = patch.condition_config
  if ('condition' in patch && !('condition_config' in patch)) patch.condition_config = patch.condition

  // Recalcular next_check_at se frequência/horário mudou
  const newFreq     = (patch.frequency     ?? watcher.frequency)     as WatcherFrequency
  const newTime     = (patch.schedule_time ?? watcher.schedule_time) as string | null
  const newTZ       = (patch.timezone      ?? watcher.timezone)      as string
  const newDays     = (patch.days_of_week  ?? watcher.days_of_week)  as string[] | null

  if ('frequency' in patch || 'schedule_time' in patch || 'timezone' in patch || 'days_of_week' in patch) {
    patch.next_check_at = calcNextRunAt({
      frequency:    newFreq,
      scheduleTime: newTime,
      timezone:     newTZ,
      daysOfWeek:   newDays,
    })
  }

  const { data, error } = await admin
    .from('watchers')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  // Log atividade
  const action = 'enabled' in patch
    ? (patch.enabled ? 'watcher_enabled' : 'watcher_disabled')
    : 'watcher_updated'

  void logActivity({
    userId:    user.id,
    eventType: 'watcher',
    action,
    detail:    `Vigia "${watcher.name}" atualizado`,
    companyId: watcher.company_id,
    metadata:  { watcher_id: id, fields: Object.keys(patch) },
  })

  return NextResponse.json(data)
}

// ─── DELETE — soft delete ────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin   = createAdminClient()
  const watcher = await fetchWatcher(id, user.id, admin)
  if (!watcher) return NextResponse.json({ error: 'Vigia não encontrado' }, { status: 404 })

  const { error } = await admin
    .from('watchers')
    .update({ deleted_at: new Date().toISOString(), status: 'archived', enabled: false })
    .eq('id', id)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: 'watcher',
    action:    'watcher_deleted',
    detail:    `Vigia "${watcher.name}" removido`,
    companyId: watcher.company_id,
    metadata:  { watcher_id: id },
  })

  return NextResponse.json({ ok: true })
}
