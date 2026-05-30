import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

const ALLOWED_COMPANIES = ['grupo', 'cppem', 'unicive', 'colegio', 'everton'] as const
type CompanyId = (typeof ALLOWED_COMPANIES)[number]

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()

  const { data: rows, error } = await adminClient
    .from('agent_companies')
    .select('id, agent_id, company_id, status, created_at')
    .eq('agent_id', id)
    .order('created_at', { ascending: true })

  if (error) {
    return Response.json({ error: 'Failed to fetch companies' }, { status: 500 })
  }

  return Response.json(rows ?? [])
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = isGlobalAdmin(user.id)
  if (!admin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { company_id?: string }
  const companyId = body.company_id

  if (!companyId || !ALLOWED_COMPANIES.includes(companyId as CompanyId)) {
    return Response.json(
      { error: `Invalid company_id. Must be one of: ${ALLOWED_COMPANIES.join(', ')}` },
      { status: 400 }
    )
  }

  const adminClient = createAdminClient()

  const { data: newRow, error: insertError } = await adminClient
    .from('agent_companies')
    .upsert({ agent_id: id, company_id: companyId }, { onConflict: 'agent_id,company_id', ignoreDuplicates: true })
    .select('id, agent_id, company_id, status, created_at')
    .single()

  if (insertError) {
    return Response.json({ error: 'Failed to attach company' }, { status: 500 })
  }

  // Mantém agents.companies[] legado em sincronia
  const { data: agentRow } = await adminClient
    .from('agents')
    .select('companies')
    .eq('id', id)
    .single()

  if (agentRow) {
    const existing: string[] = Array.isArray(agentRow.companies) ? agentRow.companies : []
    if (!existing.includes(companyId)) {
      await adminClient
        .from('agents')
        .update({ companies: [...existing, companyId] })
        .eq('id', id)
    }
  }

  await logActivity({
    userId: user.id,
    eventType: "settings",
    action: 'agent_company_attached',
    detail: `Company ${companyId} attached to agent ${id}`,
    metadata: { agent_id: id, company_id: companyId },
  })

  return Response.json(newRow, { status: 201 })
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = isGlobalAdmin(user.id)
  if (!admin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { company_id?: string }
  const companyId = body.company_id

  if (!companyId) {
    return Response.json({ error: 'company_id is required' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { error: deleteError } = await adminClient
    .from('agent_companies')
    .delete()
    .eq('agent_id', id)
    .eq('company_id', companyId)

  if (deleteError) {
    return Response.json({ error: 'Failed to remove company' }, { status: 500 })
  }

  // Keep legacy agents.companies[] in sync via array_remove
  const { data: agentRow } = await adminClient
    .from('agents')
    .select('companies')
    .eq('id', id)
    .single()

  if (agentRow) {
    const existing: string[] = Array.isArray(agentRow.companies) ? agentRow.companies : []
    const updated = existing.filter((c) => c !== companyId)
    await adminClient
      .from('agents')
      .update({ companies: updated })
      .eq('id', id)
  }

  await logActivity({
    userId: user.id,
    eventType: "settings",
    action: 'agent_company_removed',
    detail: `Company ${companyId} removed from agent ${id}`,
    metadata: { agent_id: id, company_id: companyId },
  })

  return Response.json({ ok: true })
}
