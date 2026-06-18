import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
import { createAdminClient } from '@/lib/supabase-admin'
import { isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'
import { mapAgent } from '@/lib/agent-helpers'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('company_id')

  const admin = createAdminClient()

  let agentIds: string[] | null = null
  if (companyId) {
    const { data: linkRows, error: linkError } = await admin
      .from('agent_companies')
      .select('agent_id')
      .eq('company_id', companyId)

    if (linkError) {
      return NextResponse.json({ error: 'Failed to fetch agent links' }, { status: 500 })
    }
    agentIds = (linkRows ?? []).map((r: { agent_id: string }) => r.agent_id)
    if (agentIds.length === 0) {
      return NextResponse.json([])
    }
  }

  let query = admin
    .from('agents')
    .select('*')
    .eq('kind', 'agent')           // só capacidades conversáveis (exclui workflow/simple)
    .is('deleted_at', null)
    .order('name')

  if (agentIds !== null) {
    query = query.in('id', agentIds)
  }

  const { data: agentRows, error: agentsError } = await query

  if (agentsError) {
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 })
  }

  if (!agentRows || agentRows.length === 0) {
    return NextResponse.json([])
  }

  const ids = agentRows.map((a: { id: string }) => a.id)

  const [{ data: configs }, { data: companyLinks }, { data: fileCounts }] = await Promise.all([
    admin
      .from('agent_model_configs')
      .select('*')
      .in('agent_id', ids),
    admin
      .from('agent_companies')
      .select('agent_id, company_id')
      .in('agent_id', ids),
    admin
      .from('agent_files')
      .select('agent_id')
      .in('agent_id', ids),
  ])

  const configMap = new Map((configs ?? []).map((c: { agent_id: string }) => [c.agent_id, c]))

  const companiesMap = new Map<string, string[]>()
  for (const link of companyLinks ?? []) {
    const arr = companiesMap.get(link.agent_id) ?? []
    arr.push(link.company_id)
    companiesMap.set(link.agent_id, arr)
  }

  const fileCountMap = new Map<string, number>()
  for (const f of fileCounts ?? []) {
    fileCountMap.set(f.agent_id, (fileCountMap.get(f.agent_id) ?? 0) + 1)
  }

  const result = agentRows.map((row: Record<string, unknown>) => {
    const id = row.id as string
    let companies = companiesMap.get(id) ?? []
    if (companies.length === 0 && Array.isArray(row.companies)) {
      companies = row.companies as string[]
    }
    return mapAgent(row, configMap.get(id) ?? null, companies, fileCountMap.get(id) ?? 0)
  })

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!await isGlobalAdmin(user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as Record<string, unknown>

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const newAgent: Record<string, unknown> = {
    name,
    short_name: typeof body.short_name === 'string' ? body.short_name.trim() : name,
    slug: typeof body.slug === 'string'
      ? body.slug.trim().toLowerCase()
      : name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    description: body.description ?? '',
    long_description: body.role_description ?? body.long_description ?? body.description ?? '',
    role_description: body.role_description ?? null,
    status: body.status ?? 'active',
    icon: body.icon ?? 'Bot',
    color: body.color ?? '#6366f1',
    bg_color: body.bg_color ?? 'rgba(99,102,241,0.12)',
    category: body.category ?? null,
    capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
    tools: Array.isArray(body.tools) ? body.tools : [],
    metadata: (body.metadata && typeof body.metadata === 'object') ? body.metadata : {},
    created_by: user.id,
    companies: [],
  }

  const { data: created, error: insertError } = await admin
    .from('agents')
    .insert(newAgent)
    .select('*')
    .single()

  if (insertError || !created) {
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 })
  }

  // Create default model config
  const defaultSystemPrompt = typeof body.system_prompt === 'string' && body.system_prompt.trim()
    ? body.system_prompt.trim()
    : `Você é ${name}, assistente de IA do Grupo Mota Educação. ${typeof body.description === 'string' ? body.description : ''} Responda sempre em português.`.trim()

  const modelConfig = {
    agent_id:      created.id,
    provider:      typeof body.provider  === 'string' ? body.provider  : 'anthropic',
    model_id:      typeof body.model_id  === 'string' ? body.model_id  : 'claude-sonnet-4-6',
    system_prompt: defaultSystemPrompt,
    temperature:   typeof body.temperature === 'number' ? body.temperature : 0.7,
    max_tokens:    typeof body.max_tokens  === 'number' ? body.max_tokens  : 4000,
    updated_at:    new Date().toISOString(),
  }

  const { data: createdConfig } = await admin
    .from('agent_model_configs')
    .insert(modelConfig)
    .select('*')
    .single()

  // Link to company if provided
  const companyId = typeof body.company_id === 'string' ? body.company_id : null
  if (companyId) {
    await admin
      .from('agent_companies')
      .insert({ agent_id: created.id, company_id: companyId })
    await admin
      .from('agents')
      .update({ companies: [companyId] })
      .eq('id', created.id)
  }

  await admin.from('agent_change_logs').insert({
    agent_id: created.id,
    user_id: user.id,
    action: 'agent_created',
    after: newAgent,
  })

  await logActivity({
    userId: user.id,
    eventType: 'settings',
    action: 'agent_created',
    detail: `Agent ${created.name} created`,
    metadata: { agent_id: created.id },
  })

  const companies = companyId ? [companyId] : []
  return NextResponse.json(mapAgent(created, createdConfig ?? null, companies, 0), { status: 201 })
}
