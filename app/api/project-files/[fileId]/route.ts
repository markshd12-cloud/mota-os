import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope"
import { logActivity }       from "@/lib/activity-logger"
import { mapProjectFile }    from "@/lib/project-helpers"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ fileId: string }> }

const BUCKET = "project-files"

// ─── GET — detalhes do arquivo ────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { fileId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: file } = await admin
    .from("project_files").select("*").eq("id", fileId).single()
  if (!file) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 })

  const [isAdmin, allowed] = await Promise.all([isGlobalAdmin(user.id), getAllowedCompanyIds(user.id)])
  if (!isAdmin && !allowed.includes(file.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  // Gera URL de download assinada (1 hora)
  const { data: signedUrl } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(file.storage_path, 3600)

  return NextResponse.json({ ...mapProjectFile(file), download_url: signedUrl?.signedUrl ?? null })
}

// ─── DELETE — remover arquivo (storage + DB) ──────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { fileId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: file } = await admin
    .from("project_files").select("*").eq("id", fileId).single()
  if (!file) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 })

  const [isAdmin, allowed] = await Promise.all([isGlobalAdmin(user.id), getAllowedCompanyIds(user.id)])
  if (!isAdmin && !allowed.includes(file.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  // Remove do storage (best-effort — não bloqueia se já não existir)
  await admin.storage.from(BUCKET).remove([file.storage_path]).catch(() => null)

  const { error } = await admin.from("project_files").delete().eq("id", fileId)
  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId: user.id, eventType: "settings",
    action: "Arquivo removido de projeto", detail: file.file_name, companyId: file.company_id,
  })

  return NextResponse.json({ ok: true })
}
