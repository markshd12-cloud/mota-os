/**
 * Helpers de segurança compartilhados entre webhooks e integrações.
 * SERVER-SIDE ONLY — nunca importar em Client Components.
 */

import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Comparação de strings resistente a timing attacks.
 * Retorna false sem vazar informação se os comprimentos diferem.
 */
export function timingSafeStringCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false
  const bufA = Buffer.from(a, "utf8")
  const bufB = Buffer.from(b, "utf8")
  // timingSafeEqual exige buffers do mesmo tamanho. Compara contra `bufA`
  // sempre, para que o tempo de execução não dependa do tamanho de `b`.
  if (bufA.length !== bufB.length) {
    // Faz uma comparação dummy para gastar o mesmo tempo.
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

/**
 * Verifica assinatura HMAC-SHA256 de um payload.
 * Use em webhooks que enviam header tipo X-Signature: sha256=<hex>.
 *
 * @param rawBody  body original como string (NÃO o JSON.parse)
 * @param signature valor recebido no header (com ou sem prefixo "sha256=")
 * @param secret   secret compartilhado com o provedor
 */
export function verifyHmacSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!rawBody || !signature || !secret) return false
  const cleanSig = signature.replace(/^sha256=/i, "").trim()
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex")
  return timingSafeStringCompare(cleanSig, expected)
}

/**
 * Limite máximo de body em bytes para webhooks. Defende contra payloads
 * intencionalmente enormes que travariam o parser JSON.
 */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024 // 256 KB

/**
 * Lê o body de uma Request validando tamanho. Retorna `{ ok: false }` se
 * exceder o limite, sem chamar `req.json()` (que carregaria tudo na memória).
 */
export async function readBoundedRawBody(
  req: Request,
  maxBytes: number = MAX_WEBHOOK_BODY_BYTES,
): Promise<{ ok: true; raw: string } | { ok: false; reason: "too_large" | "read_error" }> {
  // Content-Length não é confiável (cliente pode mentir), mas usa como fast-path.
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too_large" }
  }

  try {
    const reader = req.body?.getReader()
    if (!reader) return { ok: true, raw: "" }
    const chunks: Uint8Array[] = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > maxBytes) {
        await reader.cancel().catch(() => {})
        return { ok: false, reason: "too_large" }
      }
      chunks.push(value)
    }
    const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)))
    return { ok: true, raw: merged.toString("utf8") }
  } catch {
    return { ok: false, reason: "read_error" }
  }
}

/**
 * Fetch com timeout. Necessário porque o fetch nativo do Node não tem
 * timeout default e pode pendurar a request handler indefinidamente.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...rest, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
