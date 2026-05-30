import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { isGlobalAdmin } from '@/lib/company-scope'
import { logActivity } from '@/lib/activity-logger'
import { mapAgentFile, type ApiAgentFile } from '@/lib/agent-helpers'

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

const ALLOWED_EXTENSIONS = ['.md', '.txt', '.csv', '.json']
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const MAX_EXTRACTED_TEXT = 100_000

export async function POST(request: Request, { params }: Ctx) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: agent_id } = await params

  const admin = await isGlobalAdmin(user.id)
  if (!admin) {
    return Response.json(
      { error: 'Forbidden: only global admins can upload agent files' },
      { status: 403 }
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null

  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: 'File exceeds the 20 MB size limit' },
      { status: 400 }
    )
  }

  const dotIndex = file.name.lastIndexOf('.')
  const extension =
    dotIndex !== -1 ? file.name.slice(dotIndex).toLowerCase() : ''

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return Response.json(
      {
        error: `Unsupported file type. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`,
      },
      { status: 400 }
    )
  }

  const storagePath = `agents/${agent_id}/${Date.now()}_${file.name}`

  const adminClient = createAdminClient()

  const { error: uploadError } = await adminClient.storage
    .from('agent-files')
    .upload(storagePath, file)

  if (uploadError) {
    const msg = uploadError.message ?? ''
    if (
      msg.includes('bucket') ||
      msg.includes('not found') ||
      msg.includes('does not exist')
    ) {
      return Response.json(
        {
          error:
            'Storage bucket "agent-files" does not exist. Please create it in your Supabase project before uploading files.',
        },
        { status: 500 }
      )
    }
    return Response.json(
      { error: `Upload failed: ${msg}` },
      { status: 500 }
    )
  }

  // Extract text content
  let extracted_text: string | null = null
  if (ALLOWED_EXTENSIONS.includes(extension)) {
    const rawText = await file.text()
    if (extension === '.json') {
      try {
        extracted_text = JSON.stringify(JSON.parse(rawText), null, 2)
      } catch {
        extracted_text = rawText
      }
    } else {
      extracted_text = rawText
    }
    if (extracted_text && extracted_text.length > MAX_EXTRACTED_TEXT) {
      extracted_text = extracted_text.slice(0, MAX_EXTRACTED_TEXT)
    }
  }

  const { data, error: dbError } = await adminClient
    .from('agent_files')
    .insert({
      agent_id,
      company_id: null,
      uploaded_by: user.id,
      file_name: file.name,
      file_type: extension,
      file_size: file.size,
      storage_path: storagePath,
      extracted_text,
      status: 'uploaded',
    })
    .select()
    .single()

  if (dbError || !data) {
    // Cleanup storage on DB failure
    await adminClient.storage
      .from('agent-files')
      .remove([storagePath])
      .catch(() => null)

    return Response.json(
      { error: `Database insert failed: ${dbError?.message ?? 'unknown error'}` },
      { status: 500 }
    )
  }

  await logActivity({
    userId: user.id,
    eventType: 'settings',
    action: 'agent_file_uploaded',
    detail: file.name,
  })

  return Response.json(mapAgentFile(data) as ApiAgentFile, { status: 201 })
}
