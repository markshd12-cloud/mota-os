import { NextRequest, NextResponse } from 'next/server'
import { createClient }      from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { logActivity } from '@/lib/activity-logger'

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

// ─── POST — marcar como lida ──────────────────────────────────────────────────

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = createAdminClient()

  // Verificar que o anúncio existe
  const { data: ann } = await admin
    .from('announcements')
    .select('id, title')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (!ann) return NextResponse.json({ error: 'Novidade não encontrada' }, { status: 404 })

  // Upsert idempotente — atualiza read_at se já existir
  await admin.from('announcement_reads').upsert(
    { announcement_id: id, user_id: user.id, read_at: new Date().toISOString() },
    { onConflict: 'announcement_id,user_id' },
  )

  void logActivity({
    userId:    user.id,
    eventType: 'settings',
    action:    'announcement_read',
    detail:    `Novidade "${ann.title}" marcada como lida`,
    metadata:  { announcement_id: id },
  })

  // Dispatch event trigger hint (handled client-side via custom event)
  return NextResponse.json({ ok: true })
}

// ─── DELETE — desmarcar como lida ────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const admin = createAdminClient()
  await admin
    .from('announcement_reads')
    .delete()
    .eq('announcement_id', id)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}
