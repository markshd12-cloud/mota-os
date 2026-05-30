import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'
import { mapAgent, buildAgentUpdates } from '@/lib/agent-helpers'

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: agentRow, error: agentError } = await admin
    .from('agents')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (agentError || !agentRow) {
    return Response.json({ error: 'Agent not found' }, { status: 404 })
  }

  const { data: configRow } = await admin
    .from('agent_model_configs')
    .select('*')
    .eq('agent_id', id)
    .maybeSingle()

  const { data: companiesRows } = await admin
    .from('agent_companies')
    .select('company_id')
    .eq('agent_id', id)

  let companies: string[] = companiesRows?.map((r: { company_id: string }) => r.company_id) ?? []
  if (companies.length === 0 && Array.isArray(agentRow.companies)) {
    companies = agentRow.companies as string[]
  }

  const { count: filesCount } = await admin
    .from('agent_files')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', id)

  const agent = mapAgent(agentRow, configRow ?? null, companies, filesCount ?? 0)
  return Response.json(agent)
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!await isGlobalAdmin(user.id)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as Record<string, unknown>

  const adminClient = createAdminClient()

  const { data: existing, error: fetchError } = await adminClient
    .from('agents')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single()

  if (fetchError || !existing) {
    return Response.json({ error: 'Agent not found' }, { status: 404 })
  }

  const updates = buildAgentUpdates(body)
  if (!updates || Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  if (body.status === 'archived') {
    updates.archived_at = new Date().toISOString()
  }

  const { data: updated, error: updateError } = await adminClient
    .from('agents')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (updateError || !updated) {
    return Response.json({ error: 'Failed to update agent' }, { status: 500 })
  }

  await adminClient.from('agent_change_logs').insert({
    agent_id: id,
    user_id: user.id,
    action: 'agent_updated',
    before: existing,
    after: updates,
  })

  await logActivity({
    userId: user.id,
    eventType: "settings",
    action: 'agent_updated',
    detail: `Agent ${id} updated`,
    metadata: { agent_id: id },
  })

  const { data: configRow } = await adminClient
    .from('agent_model_configs')
    .select('*')
    .eq('agent_id', id)
    .maybeSingle()

  const { data: companiesRows } = await adminClient
    .from('agent_companies')
    .select('company_id')
    .eq('agent_id', id)

  let companies: string[] = companiesRows?.map((r: { company_id: string }) => r.company_id) ?? []
  if (companies.length === 0 && Array.isArray(updated.companies)) {
    companies = updated.companies as string[]
  }

  const { count: filesCount } = await adminClient
    .from('agent_files')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', id)

  return Response.json(mapAgent(updated, configRow ?? null, companies, filesCount ?? 0))
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!await isGlobalAdmin(user.id)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const adminClient = createAdminClient()

  const { error: deleteError } = await adminClient
    .from('agents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (deleteError) {
    return Response.json({ error: 'Failed to delete agent' }, { status: 500 })
  }

  await adminClient.from('agent_change_logs').insert({
    agent_id: id,
    user_id: user.id,
    action: 'agent_deleted',
  })

  await logActivity({
    userId: user.id,
    eventType: "settings",
    action: 'agent_deleted',
    detail: `Agent ${id} deleted`,
    metadata: { agent_id: id },
  })

  return Response.json({ ok: true })
}
