import { cookies } from "next/headers"
import {
  GEMINI_COOKIE_NAMES,
  getGeminiOauthConfig,
  isProductionEnv,
  nowEpochSeconds,
  tokenExpiresSoon,
  type GeminiTokenPayload,
} from "@/lib/gemini-oauth"

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure:   isProductionEnv(),
    sameSite: "lax"  as const,
    path:     "/",
    maxAge,
  }
}

async function refreshGeminiToken(refreshToken: string): Promise<GeminiTokenPayload | null> {
  const oauth = getGeminiOauthConfig()
  if (!oauth.clientId || !oauth.clientSecret) return null

  const res = await fetch(oauth.tokenUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  })

  if (!res.ok) return null
  return await res.json() as GeminiTokenPayload
}

export async function clearGeminiSession() {
  const store = await cookies()
  store.delete(GEMINI_COOKIE_NAMES.accessToken)
  store.delete(GEMINI_COOKIE_NAMES.refreshToken)
  store.delete(GEMINI_COOKIE_NAMES.expiresAt)
}

export async function getValidGeminiToken(forceRefresh = false): Promise<string | null> {
  const store        = await cookies()
  const accessToken  = store.get(GEMINI_COOKIE_NAMES.accessToken)?.value
  const refreshToken = store.get(GEMINI_COOKIE_NAMES.refreshToken)?.value
  const expiresAt    = Number.parseInt(store.get(GEMINI_COOKIE_NAMES.expiresAt)?.value ?? "0", 10)

  if (!forceRefresh && accessToken && Number.isFinite(expiresAt) && !tokenExpiresSoon(expiresAt)) {
    return accessToken
  }

  if (!refreshToken) return null

  const refreshed = await refreshGeminiToken(refreshToken)
  if (!refreshed?.access_token) {
    await clearGeminiSession()
    return null
  }

  const expiresIn        = refreshed.expires_in ?? 3600
  const nextExpiresAt    = nowEpochSeconds() + expiresIn
  const accessMaxAge     = Math.max(30, expiresIn)
  const nextRefreshToken = refreshed.refresh_token ?? refreshToken

  store.set(GEMINI_COOKIE_NAMES.accessToken,  refreshed.access_token, cookieOptions(accessMaxAge))
  store.set(GEMINI_COOKIE_NAMES.expiresAt,    String(nextExpiresAt),  cookieOptions(accessMaxAge))
  store.set(GEMINI_COOKIE_NAMES.refreshToken, nextRefreshToken,       cookieOptions(60 * 60 * 24 * 30))

  return refreshed.access_token
}
