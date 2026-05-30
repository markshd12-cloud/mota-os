import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { mapAgentFile, type ApiAgentFile } from '@/lib/agent-helpers'

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const adminClient = createAdminClient()

  const { data: rows, error } = await adminClient
    .from('agent_files')
    .select('*')
    .eq('agent_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ error: 'Failed to fetch files' }, { status: 500 })
  }

  return Response.json((rows ?? []).map(mapAgentFile) as ApiAgentFile[])
}
