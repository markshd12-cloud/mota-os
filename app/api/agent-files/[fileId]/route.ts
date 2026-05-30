import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'
import { mapAgentFile, type ApiAgentFile } from '@/lib/agent-helpers'

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ fileId: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { fileId } = await params

  const { data: file, error: fetchError } = await supabase
    .from('agent_files')
    .select('*')
    .eq('id', fileId)
    .single()

  if (fetchError || !file) {
    return Response.json({ error: 'File not found' }, { status: 404 })
  }

  const adminClient = await createAdminClient()

  const { data: signedUrlData } = await adminClient.storage
    .from('agent-files')
    .createSignedUrl(file.storage_path, 3600)

  return Response.json({
    ...(mapAgentFile(file) as ApiAgentFile),
    download_url: signedUrlData?.signedUrl ?? null,
  })
}

export async function DELETE(request: Request, { params }: Ctx) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = await isGlobalAdmin(user.id)
  if (!admin) {
    return Response.json(
      { error: 'Forbidden: only global admins can delete agent files' },
      { status: 403 }
    )
  }

  const { fileId } = await params

  const { data: file, error: fetchError } = await supabase
    .from('agent_files')
    .select('*')
    .eq('id', fileId)
    .single()

  if (fetchError || !file) {
    return Response.json({ error: 'File not found' }, { status: 404 })
  }

  const adminClient = await createAdminClient()

  await adminClient.storage
    .from('agent-files')
    .remove([file.storage_path])
    .catch(() => null)

  const { error: deleteError } = await supabase
    .from('agent_files')
    .delete()
    .eq('id', fileId)

  if (deleteError) {
    return Response.json(
      { error: `Failed to delete record: ${deleteError.message}` },
      { status: 500 }
    )
  }

  await logActivity({
    action: 'agent_file_deleted',
    detail: file.file_name,
  })

  return Response.json({ ok: true })
}
