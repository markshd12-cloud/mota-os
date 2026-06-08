/**
 * Gerencia credenciais Anthropic para ambientes sem API key estática (Vercel, etc).
 *
 * Ordem de prioridade:
 *   1. ANTHROPIC_API_KEY — se definida, usada diretamente (sem Auth0).
 *   2. Auth0 WIF         — busca JWT via client_credentials e usa como authToken.
 *
 * O token Auth0 é cacheado em memória do processo. Em Vercel serverless:
 *   - Cold start: uma chamada Auth0 (~150-300ms), depois cacheado.
 *   - Warm container: zero chamadas extras (usa cache até 5 min antes do vencimento).
 *   - Token típico Auth0 client_credentials expira em 1 hora.
 */

type TokenCache = { token: string; expiresAt: number } | null

let _cache: TokenCache = null

/**
 * Retorna o objeto de opções de auth para `new Anthropic({ ...opts })`.
 * Lança se nenhuma credencial estiver configurada.
 */
export async function getAnthropicAuthOptions(): Promise<{ apiKey: string } | { authToken: string }> {
  // 1. API key estática — preferência (curto-circuito, sem Auth0)
  if (process.env.ANTHROPIC_API_KEY) {
    return { apiKey: process.env.ANTHROPIC_API_KEY }
  }

  // 2. WIF via Auth0
  const { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET } = process.env
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID || !AUTH0_CLIENT_SECRET) {
    throw new Error(
      "Anthropic não está configurado. Defina ANTHROPIC_API_KEY " +
      "ou as variáveis Auth0 WIF (AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET) " +
      "no painel do Vercel (Settings → Environment Variables).",
    )
  }

  // Cache válido com 5 min de margem antes do vencimento
  if (_cache && Date.now() < _cache.expiresAt - 5 * 60_000) {
    return { authToken: _cache.token }
  }

  console.log("[anthropic-auth] Buscando token Auth0 para Anthropic WIF...")

  const res = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type:    "client_credentials",
      client_id:     AUTH0_CLIENT_ID,
      client_secret: AUTH0_CLIENT_SECRET,
      audience:      "https://api.anthropic.com",
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Auth0 retornou ${res.status} ao buscar token Anthropic: ${body}`)
  }

  const json = await res.json() as { access_token: string; expires_in?: number }

  if (!json.access_token) {
    throw new Error("Auth0 não retornou access_token para Anthropic.")
  }

  const expiresIn = json.expires_in ?? 3600
  _cache = { token: json.access_token, expiresAt: Date.now() + expiresIn * 1000 }

  console.log(`[anthropic-auth] Token obtido, válido por ${expiresIn}s.`)

  return { authToken: _cache.token }
}

/**
 * Verifica se alguma credencial Anthropic está configurada (API key OU Auth0 WIF).
 * Usado pelo model-registry para mostrar/ocultar o provider na UI.
 * Não faz nenhuma chamada de rede.
 */
export function isAnthropicConfigured(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true
  return !!(
    process.env.AUTH0_DOMAIN &&
    process.env.AUTH0_CLIENT_ID &&
    process.env.AUTH0_CLIENT_SECRET
  )
}
