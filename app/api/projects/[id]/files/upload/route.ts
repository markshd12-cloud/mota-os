import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope"
import { logActivity }       from "@/lib/activity-logger"
import { mapProjectFile }    from "@/lib/project-helpers"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

const BUCKET        = "project-files"
const MAX_BYTES     = 20 * 1024 * 1024 // 20 MB

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: project } = await admin
    .from("projects").select("company_id, title").eq("id", id).is("deleted_at", null).single()
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 })

  const [isAdmin, allowed] = await Promise.all([isGlobalAdmin(user.id), getAllowedCompanyIds(user.id)])
  if (!isAdmin && !allowed.includes(project.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo muito grande (máx 20 MB)" }, { status: 413 })
  }

  const ext          = file.name.split(".").pop() ?? ""
  const storagePath  = `${project.company_id}/${id}/${Date.now()}_${file.name}`
  const arrayBuffer  = await file.arrayBuffer()

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType:  file.type || "application/octet-stream",
      upsert:       false,
    })

  if (uploadError) {
    const msgLower = uploadError.message.toLowerCase()
    const isBucketMissing = msgLower.includes("bucket") || msgLower.includes("not found") ||
      msgLower.includes("does not exist") || msgLower.includes("no such")
    const msg = isBucketMissing
      ? `Bucket "${BUCKET}" não encontrado. Crie o bucket no Supabase Storage com acesso privado.`
      : uploadError.message
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const { data, error } = await admin
    .from("project_files")
    .insert({
      project_id:   id,
      company_id:   project.company_id,
      uploaded_by:  user.id,
      file_name:    file.name,
      file_type:    ext.toLowerCase(),
      file_size:    file.size,
      storage_path: storagePath,
      status:       "uploaded",
    })
    .select()
    .single()

  if (error) {
    // Remove o arquivo do storage se o registro falhou
    await admin.storage.from(BUCKET).remove([storagePath])
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  }

  void logActivity({
    userId: user.id, eventType: "settings",
    action: "Arquivo enviado para projeto", detail: `${file.name} → ${project.title}`,
    companyId: project.company_id,
  })

  return NextResponse.json(mapProjectFile(data), { status: 201 })
}
