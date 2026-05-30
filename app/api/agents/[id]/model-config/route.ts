import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

const VALID_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const
type Provider = (typeof VALID_PROVIDERS)[number]

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()

  const { data: config, error } = await adminClient
    .from('agent_model_configs')
    .select('*')
    .eq('agent_id', id)
    .maybeSingle()

  if (error) {
    return Response.json({ error: 'Failed to fetch config' }, { status: 500 })
  }

  if (!config) {
    return Response.json({ error: 'Config not found' }, { status: 404 })
  }

  return Response.json(config)
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

  const body = (await req.json()) as {
    provider?: string
    model_id?: string
    system_prompt?: string
    temperature?: number
    max_tokens?: number
  }

  if (body.provider !== undefined && !VALID_PROVIDERS.includes(body.provider as Provider)) {
    return Response.json(
      { error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` },
      { status: 400 }
    )
  }

  const adminClient = createAdminClient()

  const upsertPayload: Record<string, unknown> = {
    agent_id: id,
    updated_at: new Date().toISOString(),
  }

  if (body.provider !== undefined) upsertPayload.provider = body.provider
  if (body.model_id !== undefined) upsertPayload.model_id = body.model_id
  if (body.system_prompt !== undefined) upsertPayload.system_prompt = body.system_prompt
  if (body.temperature !== undefined) upsertPayload.temperature = body.temperature
  if (body.max_tokens !== undefined) upsertPayload.max_tokens = body.max_tokens

  const { data: config, error: upsertError } = await adminClient
    .from('agent_model_configs')
    .upsert(upsertPayload, { onConflict: 'agent_id' })
    .select('*')
    .single()

  if (upsertError || !config) {
    return Response.json({ error: 'Failed to update config' }, { status: 500 })
  }

  await adminClient.from('agent_change_logs').insert({
    agent_id: id,
    user_id: user.id,
    action: 'agent_model_config_updated',
    after: upsertPayload,
  })

  await logActivity({
    userId: user.id,
    eventType: 'settings',
    action: 'agent_model_config_updated',
    detail: `Model config updated for agent ${id}`,
    metadata: { agent_id: id },
  })

  return Response.json(config)
}
