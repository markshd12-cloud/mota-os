/**
 * Rate limiter em memória (sliding window) + helpers de tamanho de body.
 * SERVER-SIDE ONLY.
 *
 * IMPORTANTE: funciona em deploy single-instance (Coolify, VPS, processo único).
 * Em serverless multi-instance (Vercel multi-region) o limite é por instância.
 * Para produção em escala, trocar por Upstash Redis ou similar.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface RateLimitResult {
  ok:        boolean
  limit:     number
  remaining: number
  resetAt:   number  // timestamp ms quando a janela reseta
  resetIn:   number  // segundos até resetar (compat legada)
}

// ─── Limites de requisições por rota ─────────────────────────────────────────

export const RATE_LIMITS = {
  chat:            { limit: 30, windowMs:      60_000 },
  slashAgent:      { limit: 30, windowMs:      60_000 },
  browser:         { limit: 5,  windowMs:      60_000 },
  finance:         { limit: 10, windowMs:      60_000 },
  automation:      { limit: 20, windowMs:      60_000 },
  default:         { limit: 60, windowMs:      60_000 },
  // Auth — janela de 15 min para limitar tentativas de brute-force
  auth_login:      { limit: 10, windowMs: 15 * 60_000 },
  auth_magic_link: { limit: 5,  windowMs: 15 * 60_000 },
  auth_recovery:   { limit: 5,  windowMs: 15 * 60_000 },
  // Chaves usadas pelas rotas server-side (email-login / email-reset)
  authLogin:       { limit: 5,  windowMs:     900_000 }, // 5 tentativas em 15 min
  authReset:       { limit: 3,  windowMs:   3_600_000 }, // 3 tentativas em 1 hora
} as const

// ─── Auth rate limit habilitado? ──────────────────────────────────────────────
// Defina AUTH_RATE_LIMIT_ENABLED=false em .env.local para desabilitar em dev/testes.
// Em produção, mantenha omitido ou true.
export function isAuthRateLimitEnabled(): boolean {
  return process.env.AUTH_RATE_LIMIT_ENABLED !== "false"
}

// ─── Limites de tamanho de body (bytes) ──────────────────────────────────────

export const BODY_LIMITS = {
  chat:      120_000,   // ~120 KB — chat normal
  summarize: 250_000,   // ~250 KB — /summarize aceita textos maiores
  default:   100_000,   // ~100 KB — demais rotas
} as const

// ─── Bucket store ─────────────────────────────────────────────────────────────

interface Bucket {
  windowStart: number
  count:       number
}

const buckets = new Map<string, Bucket>()

let lastCleanup = Date.now()
const CLEANUP_INTERVAL = 5 * 60_000

function cleanup(now: number, maxAgeMs: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > maxAgeMs) buckets.delete(key)
  }
}

// ─── rateLimit ────────────────────────────────────────────────────────────────

/**
 * Aplica rate limit em uma chave (geralmente user ID ou IP+route).
 * Retorna `{ ok: false }` se excedeu o limite — chamador deve responder 429.
 *
 * @example
 *   const rl = rateLimit(`chat:${user.id}`, RATE_LIMITS.chat)
 *   if (!rl.ok) return rateLimitSseResponse(rl.resetAt)
 */
export function rateLimit(
  key:  string,
  opts: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now()
  cleanup(now, opts.windowMs * 2)

  const existing = buckets.get(key)
  if (!existing || now - existing.windowStart >= opts.windowMs) {
    buckets.set(key, { windowStart: now, count: 1 })
    return {
      ok:        true,
      limit:     opts.limit,
      remaining: opts.limit - 1,
      resetAt:   now + opts.windowMs,
      resetIn:   Math.ceil(opts.windowMs / 1000),
    }
  }

  existing.count++
  const remaining = Math.max(0, opts.limit - existing.count)
  const resetAt   = existing.windowStart + opts.windowMs
  const resetIn   = Math.ceil((resetAt - now) / 1000)

  return { ok: existing.count <= opts.limit, limit: opts.limit, remaining, resetAt, resetIn }
}

// ─── Responses ────────────────────────────────────────────────────────────────

/**
 * Resposta 429 padrão JSON.
 */
export function rateLimitResponse(resetAt: number): Response {
  return new Response(
    JSON.stringify({ error: "Muitas requisições. Tente novamente em alguns instantes." }),
    {
      status: 429,
      headers: {
        "Content-Type":  "application/json",
        "Retry-After":   String(Math.ceil((resetAt - Date.now()) / 1000)),
      },
    },
  )
}

/**
 * Resposta 429 em formato SSE (para rotas de streaming).
 */
export function rateLimitSseResponse(resetAt: number): Response {
  const retryIn = Math.ceil((resetAt - Date.now()) / 1000)
  return new Response(
    `data: ${JSON.stringify({ type: "error", error: `Limite de requisições atingido. Aguarde ${retryIn}s.` })}\n\n`,
    {
      status: 429,
      headers: {
        "Content-Type":  "text/event-stream",
        "Retry-After":   String(retryIn),
      },
    },
  )
}

// ─── Body size helpers ────────────────────────────────────────────────────────

/**
 * Retorna o tamanho aproximado do body em bytes antes de fazer `.json()`.
 * Usa o header Content-Length quando disponível (mais barato).
 * Retorna null se não for possível calcular.
 */
export function getRequestBodySize(req: Request): number | null {
  const cl = req.headers.get("content-length")
  if (cl) {
    const n = parseInt(cl, 10)
    return isNaN(n) ? null : n
  }
  return null
}

/**
 * Verifica se o body da request ultrapassa um limite em bytes.
 * Usa Content-Length quando disponível (sem consumir o stream).
 * Se não houver Content-Length, assume que cabe (retorna false).
 */
export function isBodyTooLarge(req: Request, limitBytes: number): boolean {
  const size = getRequestBodySize(req)
  if (size === null) return false   // não sabe — deixa passar, validar depois
  return size > limitBytes
}

/** Alias de compatibilidade para código existente que usa rateLimitJsonResponse. */
export const rateLimitJsonResponse = rateLimitResponse

// ─── IP helper (compat) ───────────────────────────────────────────────────────

export function getClientIp(req: Request): string {
  const xfwd = req.headers.get("x-forwarded-for")
  if (xfwd) return xfwd.split(",")[0].trim()
  const real = req.headers.get("x-real-ip")
  if (real) return real.trim()
  return "unknown"
}
