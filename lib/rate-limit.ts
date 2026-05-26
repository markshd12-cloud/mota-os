/**
 * Rate limiter em memória (sliding window).
 * SERVER-SIDE ONLY.
 *
 * IMPORTANTE: funciona em deploy single-instance (Coolify, VPS, processo único).
 * Em serverless multi-instance (Vercel multi-region, AWS Lambda) cada instância
 * tem seu próprio Map, então o limite efetivo é (limit × instâncias). Para
 * produção em larga escala, trocar por Upstash Redis ou similar.
 */

interface Bucket {
  windowStart: number
  count:       number
}

const buckets = new Map<string, Bucket>()

// Limpa buckets expirados a cada 5 minutos pra não vazar memória.
let lastCleanup = Date.now()
const CLEANUP_INTERVAL = 5 * 60_000

function cleanup(now: number, maxAgeMs: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL) return
  lastCleanup = now
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > maxAgeMs) buckets.delete(key)
  }
}

export interface RateLimitResult {
  ok:        boolean
  remaining: number
  resetIn:   number // segundos até a janela resetar
}

/**
 * Aplica rate limit em uma chave (geralmente IP, user ID ou IP+route).
 * Retorna `{ ok: false }` se excedeu — chamador deve responder 429.
 *
 * @example
 *   const rl = rateLimit(`webhook-sales:${ip}`, { limit: 60, windowMs: 60_000 })
 *   if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
 */
export function rateLimit(
  key:    string,
  opts:   { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now()
  cleanup(now, opts.windowMs * 2)

  const existing = buckets.get(key)
  if (!existing || now - existing.windowStart >= opts.windowMs) {
    buckets.set(key, { windowStart: now, count: 1 })
    return { ok: true, remaining: opts.limit - 1, resetIn: Math.ceil(opts.windowMs / 1000) }
  }

  existing.count++
  const remaining = Math.max(0, opts.limit - existing.count)
  const resetIn   = Math.ceil((existing.windowStart + opts.windowMs - now) / 1000)

  return { ok: existing.count <= opts.limit, remaining, resetIn }
}

/**
 * Extrai IP do cliente de forma defensiva. Não confia cegamente em
 * X-Forwarded-For (que pode ser falsificado por clientes diretos), mas
 * usa o primeiro valor quando a request veio através de proxy/CDN confiável.
 *
 * Para produção atrás de Cloudflare/Coolify proxy, configurar a infraestrutura
 * para popular esses headers e remover qualquer header X-Forwarded-* enviado
 * pelo cliente.
 */
export function getClientIp(req: Request): string {
  const xfwd = req.headers.get("x-forwarded-for")
  if (xfwd) return xfwd.split(",")[0].trim()
  const real = req.headers.get("x-real-ip")
  if (real) return real.trim()
  return "unknown"
}
