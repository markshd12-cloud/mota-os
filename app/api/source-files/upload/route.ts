import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds, ALL_SLUGS } from "@/lib/company-scope"
import { logActivity }       from "@/lib/activity-logger"
import { apiError, dbError as handleDbError } from "@/lib/api-error"

export const dynamic = "force-dynamic"

const ACCEPTED_TYPES: Record<string, string> = {
  "text/plain":                "txt",
  "text/markdown":             "md",
  "text/csv":                  "csv",
  "application/json":          "json",
  "application/pdf":           "pdf",
  "text/x-markdown":           "md",
}

const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const TEXT_LIMIT     = 100_000          // Limita texto extraído a 100k chars

// Magic bytes para verificação de MIME real (evita spoofing de Content-Type)
// Compara os primeiros bytes do arquivo contra assinaturas conhecidas.
function detectMime(bytes: Uint8Array): string | null {
  // PDF: %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf"
  }
  // ZIP / DOCX / XLSX (PK): bloquear — não é texto
  if (bytes[0] === 0x50 && bytes[1] === 0x4B) return "application/zip"
  // ELF (executável Linux)
  if (bytes[0] === 0x7F && bytes[1] === 0x45 && bytes[2] === 0x4C && bytes[3] === 0x46) {
    return "application/octet-stream"
  }
  // MZ (executável Windows / PE)
  if (bytes[0] === 0x4D && bytes[1] === 0x5A) return "application/octet-stream"
  // Arquivo de texto — sem assinatura binária específica
  return null  // null = não identificado por magic bytes, aceita o Content-Type declarado
}

function isBinaryMime(mime: string | null): boolean {
  if (!mime) return false
  return mime === "application/zip" || mime === "application/octet-stream"
}

async function extractText(file: File): Promise<{ text: string | null; warning: string | null }> {
  const mime = file.type.split(";")[0].trim()

  if (mime === "application/pdf") {
    return { text: null, warning: "PDF: extração de texto não disponível. Arquivo salvo sem texto indexado." }
  }

  try {
    const raw = await file.text()
    if (mime === "application/json") {
      try {
        const parsed = JSON.parse(raw)
        const text   = JSON.stringify(parsed, null, 2).slice(0, TEXT_LIMIT)
        return { text, warning: null }
      } catch {
        return { text: raw.slice(0, TEXT_LIMIT), warning: null }
      }
    }
    return { text: raw.slice(0, TEXT_LIMIT), warning: null }
  } catch {
    return { text: null, warning: "Não foi possível extrair texto do arquivo." }
  }
}

export async function POST(req: NextRequest) {
  // ─── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // ─── Form data ────────────────────────────────────────────────────────────────
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: "Corpo inválido — envie multipart/form-data" }, { status: 400 })
  }

  const file      = form.get("file")      as File   | null
  const companyId = form.get("company_id")as string | null
  const sourceId  = form.get("source_id") as string | null  // opcional

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Campo 'file' obrigatório" }, { status: 400 })
  }
  if (!companyId || !(ALL_SLUGS as string[]).includes(companyId)) {
    return NextResponse.json({ error: "company_id inválido" }, { status: 400 })
  }

  // ─── Validação de tipo e tamanho ──────────────────────────────────────────────
  const mime = file.type.split(";")[0].trim()
  if (!ACCEPTED_TYPES[mime]) {
    return NextResponse.json({
      error: `Tipo de arquivo não suportado: ${mime}. Aceitos: txt, md, csv, json, pdf`,
    }, { status: 415 })
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Arquivo muito grande. Máximo: 10 MB" }, { status: 413 })
  }

  // ─── Verificação de magic bytes (anti-spoofing de MIME) ───────────────────────
  // Lê apenas os primeiros 8 bytes para detectar executáveis e ZIPs disfarçados
  const headerSlice = await file.slice(0, 8).arrayBuffer()
  const realMime    = detectMime(new Uint8Array(headerSlice))
  if (isBinaryMime(realMime)) {
    return NextResponse.json(
      { error: "Tipo de arquivo rejeitado: conteúdo binário não permitido." },
      { status: 415 },
    )
  }
  // PDF declarado deve ser PDF real
  if (mime === "application/pdf" && realMime !== null && realMime !== "application/pdf") {
    return NextResponse.json(
      { error: "Arquivo declarado como PDF mas com conteúdo inválido." },
      { status: 415 },
    )
  }

  // ─── Acesso à empresa ─────────────────────────────────────────────────────────
  const [admin_, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!admin_ && !allowed.includes(companyId as typeof ALL_SLUGS[number])) {
    return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
  }

  // ─── Extrair texto ────────────────────────────────────────────────────────────
  const { text: extractedText, warning } = await extractText(file)

  // ─── Upload para Supabase Storage ─────────────────────────────────────────────
  const admin       = createAdminClient()
  const ext         = ACCEPTED_TYPES[mime]
  const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  const storagePath = `${companyId}/${Date.now()}_${safeName}`

  const bytes  = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  const { error: uploadError } = await admin.storage
    .from("knowledge-files")
    .upload(storagePath, buffer, {
      contentType:  file.type,
      cacheControl: "3600",
      upsert:       false,
    })

  if (uploadError) {
    const isBucketMissing = uploadError.message.toLowerCase().includes("bucket") ||
      uploadError.message.toLowerCase().includes("not found") ||
      uploadError.message.toLowerCase().includes("does not exist") ||
      uploadError.message.toLowerCase().includes("no such")
    return apiError(
      500,
      uploadError,
      isBucketMissing
        ? `Bucket "knowledge-files" não encontrado. Crie o bucket no Supabase Storage com acesso privado.`
        : undefined,
    )
  }

  // ─── Salvar em source_files ───────────────────────────────────────────────────
  const { data: fileRecord, error: dbError } = await admin
    .from("source_files")
    .insert({
      company_id:           companyId,
      user_id:              user.id,
      knowledge_source_id:  sourceId ?? null,
      file_name:            file.name,
      file_type:            ext,
      file_size:            file.size,
      storage_path:         storagePath,
      extracted_text:       extractedText,
      upload_status:        "uploaded",
      metadata:             { original_mime: file.type, warning: warning ?? undefined },
    })
    .select("id, file_name, file_type, file_size, storage_path, upload_status, extracted_text")
    .single()

  if (dbError) {
    return handleDbError(dbError, "source_files.insert")
  }

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Arquivo enviado",
    detail:    `${file.name} (${ext}) → ${companyId}`,
    companyId,
  })

  return NextResponse.json({
    ...fileRecord,
    warning: warning ?? null,
  }, { status: 201 })
}
