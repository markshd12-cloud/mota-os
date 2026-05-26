/**
 * Autenticação via Service Account para a Gemini API.
 * SERVER-SIDE ONLY — nunca importar em Client Components.
 *
 * Variável de ambiente requerida:
 *   GOOGLE_SERVICE_ACCOUNT_KEY — conteúdo do JSON do Service Account
 *                                 (raw JSON ou base64-encoded)
 *
 * Como obter:
 *   1. Google Cloud Console → IAM & Admin → Service Accounts
 *   2. Criar conta de serviço no projeto (ex.: gemini-api-sa@savvy-courage-497418-n3.iam.gserviceaccount.com)
 *   3. Conceder papel: roles/serviceusage.serviceUsageConsumer (mínimo)
 *   4. Chaves → Adicionar chave → JSON → Fazer download
 *   5. Copiar o conteúdo do JSON para .env.local como GOOGLE_SERVICE_ACCOUNT_KEY
 */

import { google } from "googleapis"

interface TokenCache {
  token:     string
  expiresAt: number
}

let cache: TokenCache | null = null

/** Faz parse do JSON do service account; aceita raw JSON ou base64. */
function parseServiceAccountKey(raw: string): {
  client_email: string
  private_key:  string
} | null {
  // 1. Tenta raw JSON
  try {
    const parsed = JSON.parse(raw)
    if (parsed.client_email && parsed.private_key) {
      return { client_email: parsed.client_email, private_key: parsed.private_key }
    }
  } catch { /* tenta base64 */ }

  // 2. Tenta base64-encoded JSON
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf-8")
    const parsed  = JSON.parse(decoded)
    if (parsed.client_email && parsed.private_key) {
      return { client_email: parsed.client_email, private_key: parsed.private_key }
    }
  } catch { /* ignore */ }

  return null
}

/**
 * Retorna um access token válido para a conta de serviço configurada.
 * Token é cacheado em memória e renovado automaticamente antes de expirar.
 *
 * Retorna `null` se `GOOGLE_SERVICE_ACCOUNT_KEY` não estiver configurado
 * ou se a autenticação falhar.
 */
export async function getServiceAccountToken(): Promise<string | null> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) return null

  // Retorna do cache se ainda válido (com margem de 60 s)
  if (cache && Date.now() < cache.expiresAt - 60_000) {
    return cache.token
  }

  const credentials = parseServiceAccountKey(raw)
  if (!credentials) {
    console.error("[gemini-sa] GOOGLE_SERVICE_ACCOUNT_KEY inválido: forneça o JSON do service account (raw ou base64).")
    return null
  }

  try {
    const jwtClient = new google.auth.JWT({
      email:  credentials.client_email,
      key:    credentials.private_key,
      scopes: [
        "https://www.googleapis.com/auth/generative-language",
        "https://www.googleapis.com/auth/cloud-platform",
      ],
    })

    const tokens = await jwtClient.authorize()
    const token  = tokens.access_token

    if (!token) {
      console.error("[gemini-sa] authorize() não retornou access_token")
      return null
    }

    // Tokens do Google duram 1 hora; cache por 55 min
    cache = {
      token,
      expiresAt: Date.now() + 55 * 60 * 1000,
    }

    return cache.token
  } catch (err) {
    console.error("[gemini-sa] Falha ao obter token de service account:", err)
    return null
  }
}
