import { NextRequest, NextResponse } from 'next/server'
import { createClient }      from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { getAllowedCompanyIds, isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

const VALID_TYPES    = ['update', 'feature', 'fix', 'warning', 'announcement', 'maintenance']
const VALID_STATUSES = ['draft', 'published', 'archived']
const VALID_PRIOS    = ['low', 'normal', 'high', 'urgent']

// ─── GET — detalhes de uma novidade ──────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const isAdmin = await isGlobalAdmin(user.id)
  const allowed = isAdmin ? null : await getAllowedCompanyIds(user.id)
  const admin   = createAdminClient()

  const { data, error } = await admin
    .from('announcements')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  // Acesso: admin vê tudo; usuário só vê published + empresa permitida
  if (!isAdmin) {
    if (data.status !== 'published') return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
    if (data.company_id && allowed && !allowed.includes(data.company_id)) {
      return NextResponse.json({ error: 'Sem acesso' }, { status: 403 })
    }
  }

  const { data: readRow } = await admin
    .from('announcement_reads')
    .select('id')
    .eq('announcement_id', id)
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({ ...data, is_read: !!readRow })
}

// ─── PATCH — atualizar novidade (admin only) ──────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  if (!await isGlobalAdmin(user.id)) {
    return NextResponse.json({ error: 'Apenas administradores podem editar novidades' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('announcements')
    .select('id, title, status')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (!existing) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const body = await req.json() as Record<string, unknown>
  const ALLOWED_FIELDS = ['title', 'content', 'type', 'status', 'version', 'company_id', 'audience', 'priority', 'published_at', 'metadata']

  const patch: Record<string, unknown> = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in body) patch[key] = body[key] ?? null
  }

  // Validações rápidas
  if ('type'   in patch && !VALID_TYPES.includes(patch.type as string))
    return NextResponse.json({ error: `type inválido: ${patch.type}` }, { status: 400 })
  if ('status' in patch && !VALID_STATUSES.includes(patch.status as string))
    return NextResponse.json({ error: `status inválido: ${patch.status}` }, { status: 400 })
  if ('priority' in patch && !VALID_PRIOS.includes(patch.priority as string))
    return NextResponse.json({ error: `priority inválido: ${patch.priority}` }, { status: 400 })

  // Ao publicar: define published_at se não veio
  if (patch.status === 'published' && existing.status !== 'published' && !('published_at' in patch)) {
    patch.published_at = new Date().toISOString()
  }
  // Ao arquivar: define archived_at
  if (patch.status === 'archived') {
    patch.archived_at = new Date().toISOString()
  }

  const { data, error } = await admin
    .from('announcements')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  const action = patch.status === 'published' ? 'announcement_published'
    : patch.status === 'archived' ? 'announcement_deleted'
    : 'announcement_updated'

  void logActivity({
    userId:    user.id,
    eventType: 'settings',
    action,
    detail:    `Novidade "${existing.title}" atualizada`,
    metadata:  { announcement_id: id, fields: Object.keys(patch) },
  })

  return NextResponse.json(data)
}

// ─── DELETE — soft delete (admin only) ───────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  if (!await isGlobalAdmin(user.id)) {
    return NextResponse.json({ error: 'Apenas administradores podem remover novidades' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('announcements')
    .select('id, title')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (!existing) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const { error } = await admin
    .from('announcements')
    .update({ deleted_at: new Date().toISOString(), status: 'archived' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: 'settings',
    action:    'announcement_deleted',
    detail:    `Novidade "${existing.title}" removida`,
    metadata:  { announcement_id: id },
  })

  return NextResponse.json({ ok: true })
}
