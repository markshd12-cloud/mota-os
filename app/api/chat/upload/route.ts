import { NextRequest, NextResponse } from "next/server"
import { createClient }             from "@/lib/supabase-server"
import { createAdminClient }        from "@/lib/supabase-admin"
import { getAllowedCompanyIds, getCurrentCompany } from "@/lib/company-scope"
import { logActivity }              from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

// ── Constantes de segurança ───────────────────────────────────────────────────

const MAX_FILE_BYTES  = 10 * 1024 * 1024   // 10 MB por arquivo
const MAX_TOTAL_BYTES = 25 * 1024 * 1024   // 25 MB total
const MAX_FILES       = 5

const ALLOWED_MIME = new Set([
  "text/plain", "text/markdown", "text/csv", "text/x-markdown",
  "application/pdf",
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
])

const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "sh", "ps1", "js", "mjs", "cjs", "vbs",
  "jar", "scr", "dll", "com", "pif", "hta", "vbe", "wsf", "wsh",
  "reg", "inf", "msi", "cab",
])

const BUCKET = "chat-attachments"

function fileType(mime: string): "image" | "text" | "pdf" | "csv" | "other" {
  if (mime.startsWith("image/"))      return "image"
  if (mime === "application/pdf")     return "pdf"
  if (mime === "text/csv")            return "csv"
  if (mime.startsWith("text/"))       return "text"
  return "other"
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-]/g, "_").slice(0, 120)
}

async function extractText(
  file:  File,
  mime:  string,
): Promise<{ text: string | null; warning: string | null }> {
  try {
    if (mime.startsWith("text/")) {
      const text = await file.text()
      return { text: text.slice(0, 60_000), warning: null }
    }
    if (mime === "application/pdf") {
      return { text: null, warning: "Extração de PDF ainda não está ativa. O arquivo foi salvo mas não será analisado automaticamente." }
    }
    return { text: null, warning: null }
  } catch {
    return { text: null, warning: "Não foi possível extrair o texto do arquivo." }
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  // Resolve empresa
  const allowedCompanies = await getAllowedCompanyIds(user.id)
  const companyId        = (req.nextUrl.searchParams.get("company_id") as string | null)
    ?? await getCurrentCompany(user.id)

  if (!(allowedCompanies as string[]).includes(companyId)) {
    return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
  }

  const sessionId = req.nextUrl.searchParams.get("session_id") ?? undefined

  // Parse multipart
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Payload inválido. Envie multipart/form-data." }, { status: 400 })
  }

  const files = formData.getAll("files") as File[]
  if (!files.length) return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 })
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Máximo ${MAX_FILES} arquivos por mensagem.` }, { status: 400 })
  }

  // Valida tamanho total
  const totalBytes = files.reduce((s, f) => s + f.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: `Total de arquivos muito grande. Limite: 25 MB.` }, { status: 400 })
  }

  const results: {
    id: string; file_name: string; file_type: string; size_bytes: number
    mime_type: string; extracted_text: string | null; warning: string | null
  }[] = []

  for (const file of files) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""

    // Bloquear extensões perigosas
    if (BLOCKED_EXTENSIONS.has(ext)) {
      void logActivity({
        userId: user.id, eventType: "api", action: "chat_attachment_rejected",
        detail: `Extensão bloqueada: ${ext}`, companyId,
        metadata: { file_name: file.name, reason: "blocked_extension" },
      })
      return NextResponse.json({ error: `Tipo de arquivo não permitido: .${ext}` }, { status: 400 })
    }

    // Validar MIME
    if (!ALLOWED_MIME.has(file.type)) {
      void logActivity({
        userId: user.id, eventType: "api", action: "chat_attachment_rejected",
        detail: `MIME não permitido: ${file.type}`, companyId,
        metadata: { file_name: file.name, mime: file.type },
      })
      return NextResponse.json({ error: `Tipo de arquivo não suportado: ${file.type}` }, { status: 400 })
    }

    // Validar tamanho por arquivo
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `"${file.name}" excede o limite de 10 MB.` }, { status: 400 })
    }

    // Path no storage
    const safeName    = sanitizeFileName(file.name)
    const storagePath = `${companyId}/${sessionId ?? "no-session"}/${user.id}/${Date.now()}-${safeName}`

    // Upload para Supabase Storage
    const bytes = await file.arrayBuffer()
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType:   file.type,
        cacheControl:  "3600",
        upsert:        false,
      })

    if (upErr) {
      console.error("[upload] storage error:", upErr.message)
      return NextResponse.json({ error: `Erro ao salvar "${file.name}". Tente novamente.` }, { status: 500 })
    }

    // Extrai texto se aplicável
    const { text: extractedText, warning } = await extractText(file, file.type)

    // Insere no banco
    const { data: row, error: dbErr } = await admin
      .from("chat_attachments")
      .insert({
        session_id:     sessionId ?? null,
        message_id:     null,
        company_id:     companyId,
        user_id:        user.id,
        file_name:      file.name,
        file_type:      fileType(file.type),
        mime_type:      file.type,
        size_bytes:     file.size,
        storage_path:   storagePath,
        extracted_text: extractedText,
        metadata:       { can_index: true, source: "chat_attachment", warning },
      })
      .select("id")
      .single()

    if (dbErr || !row) {
      console.error("[upload] db insert error:", dbErr?.message)
      return NextResponse.json({ error: "Erro ao registrar anexo." }, { status: 500 })
    }

    void logActivity({
      userId: user.id, eventType: "api", action: "chat_attachment_uploaded",
      detail: `${file.name} (${file.type})`, companyId,
      metadata: { attachment_id: row.id, size_bytes: file.size, file_type: fileType(file.type) },
    })

    results.push({
      id:             row.id,
      file_name:      file.name,
      file_type:      fileType(file.type),
      size_bytes:     file.size,
      mime_type:      file.type,
      extracted_text: extractedText,
      warning,
    })
  }

  return NextResponse.json({ attachments: results })
}
