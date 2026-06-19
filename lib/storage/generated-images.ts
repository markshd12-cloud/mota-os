/**
 * Persistência de imagens geradas pela IA no Supabase Storage.
 * SERVER-SIDE ONLY.
 *
 * Usa um bucket PÚBLICO dedicado (`generated-images`) para que a URL possa ser
 * embutida diretamente como `![](url)` no markdown do chat e persista no
 * histórico (diferente de signed URLs, que expiram).
 */

import { createAdminClient } from "@/lib/supabase-admin"

const BUCKET = "generated-images"

// Evita chamar createBucket a cada request (idempotência barata em memória).
let bucketEnsured = false

async function ensureBucket(admin: ReturnType<typeof createAdminClient>): Promise<void> {
  if (bucketEnsured) return
  // createBucket é idempotente na prática: se já existir, retorna erro que ignoramos.
  await admin.storage.createBucket(BUCKET, {
    public:           true,
    fileSizeLimit:    "15MB",
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  }).catch(() => { /* já existe */ })
  bucketEnsured = true
}

function extFor(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg"
  if (mimeType.includes("webp")) return "webp"
  return "png"
}

/**
 * Salva uma imagem base64 no bucket público e retorna a URL pública.
 * `pathPrefix` organiza por empresa/sessão (ex: "cppem/<sessionId>").
 */
export async function saveGeneratedImage(
  base64:    string,
  mimeType:  string,
  pathPrefix: string,
): Promise<string> {
  const admin = createAdminClient()
  await ensureBucket(admin)

  const ext   = extFor(mimeType)
  const rand  = Math.random().toString(36).slice(2, 8)
  const path  = `${pathPrefix}/${Date.now()}-${rand}.${ext}`
  const bytes = Buffer.from(base64, "base64")

  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType:  mimeType,
      cacheControl: "31536000",   // 1 ano (imagem imutável)
      upsert:       false,
    })

  if (error) {
    throw new Error(`Erro ao salvar imagem no storage: ${error.message}`)
  }

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
