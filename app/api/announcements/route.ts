import { NextRequest, NextResponse } from 'next/server'
import { createClient }      from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { getAllowedCompanyIds, isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'

export const dynamic = 'force-dynamic'

const VALID_TYPES    = ['update', 'feature', 'fix', 'warning', 'announcement', 'maintenance'] as const
const VALID_STATUSES = ['draft', 'published', 'archived'] as const
const VALID_PRIOS    = ['low', 'normal', 'high', 'urgent'] as const
const VALID_AUDIENCE = ['all', 'admins', 'company', 'role'] as const

// ─── GET — listar novidades visíveis ao usuário ───────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const typeParam    = searchParams.get('type')
  const statusParam  = searchParams.get('status')
  const unreadOnly   = searchParams.get('unread_only') === 'true'
  const companyParam = searchParams.get('company_id')
  const limit        = Math.min(Number(searchParams.get('limit') ?? 50), 100)
  const offset       = Number(searchParams.get('offset') ?? 0)

  const isAdmin = await isGlobalAdmin(user.id)
  const allowed = isAdmin ? null : await getAllowedCompanyIds(user.id)

  const admin = createAdminClient()

  // Status: admin pode ver tudo; usuário só vê publicados
  const statuses = isAdmin
    ? (statusParam ? [statusParam] : ['draft', 'published', 'archived'])
    : ['published']

  let query = admin
    .from('announcements')
    .select('*')
    .is('deleted_at', null)
    .in('status', statuses)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (typeParam) query = query.eq('type', typeParam)

  // Filtro de empresa: usuário comum vê global (null) + suas empresas
  if (!isAdmin) {
    if (allowed && allowed.length > 0) {
      query = query.or(`company_id.is.null,company_id.in.(${allowed.join(',')})`)
    } else {
      query = query.is('company_id', null)
    }
  } else if (companyParam) {
    query = query.eq('company_id', companyParam)
  }

  const { data: announcements, error } = await query
  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  // IDs já lidos pelo usuário
  const { data: readRows } = await admin
    .from('announcement_reads')
    .select('announcement_id')
    .eq('user_id', user.id)

  const readSet = new Set((readRows ?? []).map(r => r.announcement_id as string))

  const rows = (announcements ?? []).map(a => ({ ...a, is_read: readSet.has(a.id) }))
  const result = unreadOnly ? rows.filter(a => !a.is_read) : rows

  return NextResponse.json(result)
}

// ─── POST — criar novidade (admin only) ──────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  if (!await isGlobalAdmin(user.id)) {
    return NextResponse.json({ error: 'Apenas administradores podem criar novidades' }, { status: 403 })
  }

  const body = await req.json() as Record<string, unknown>

  const title   = typeof body.title   === 'string' ? body.title.trim()   : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const type    = typeof body.type    === 'string' ? body.type            : 'update'
  const status  = typeof body.status  === 'string' ? body.status          : 'published'

  if (!title)   return NextResponse.json({ error: 'title é obrigatório' },   { status: 400 })
  if (!content) return NextResponse.json({ error: 'content é obrigatório' }, { status: 400 })
  if (!VALID_TYPES.includes(type as typeof VALID_TYPES[number]))
    return NextResponse.json({ error: `type inválido: ${type}` }, { status: 400 })
  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number]))
    return NextResponse.json({ error: `status inválido: ${status}` }, { status: 400 })

  const priority  = VALID_PRIOS.includes(body.priority as typeof VALID_PRIOS[number]) ? body.priority as string : 'normal'
  const audience  = VALID_AUDIENCE.includes(body.audience as typeof VALID_AUDIENCE[number]) ? body.audience as string : 'all'
  const companyId = typeof body.company_id === 'string' && body.company_id ? body.company_id : null
  const version   = typeof body.version    === 'string' && body.version    ? body.version.trim() : null

  const publishedAt = status === 'published'
    ? (typeof body.published_at === 'string' ? body.published_at : new Date().toISOString())
    : null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('announcements')
    .insert({
      title, content, type, status, version,
      company_id:   companyId,
      audience,
      priority,
      published_at: publishedAt,
      metadata:     (body.metadata && typeof body.metadata === 'object') ? body.metadata : {},
      created_by:   user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: 'settings',
    action:    status === 'published' ? 'announcement_published' : 'announcement_created',
    detail:    `Novidade "${title}" ${status === 'published' ? 'publicada' : 'criada como rascunho'}`,
    companyId: companyId ?? undefined,
    metadata:  { announcement_id: data.id, type, status },
  })

  return NextResponse.json(data, { status: 201 })
}
