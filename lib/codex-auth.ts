import { cookies } from "next/headers"
import {
  CODEX_COOKIE_NAMES,
  decodeJwtPayload,
  getOauthConfig,
  getTokenRequestHeaders,
  nowEpochSeconds,
  tokenExpiresSoon,
  type CodexTokenPayload,
} from "@/lib/codex-oauth"
import { getCodexCookieOptions } from "@/lib/codex-cookies"

type JwtWithExp = { exp?: number; sub?: string }

function resolveExpiry(accessToken: string, expiresIn?: number): number {
  if (expiresIn && Number.isFinite(expiresIn)) {
    return nowEpochSeconds() + expiresIn
  }

  const decoded = decodeJwtPayload<JwtWithExp>(accessToken)
  if (decoded?.exp && Number.isFinite(decoded.exp)) {
    return decoded.exp
  }

  return nowEpochSeconds() + 3600
}

async function refreshWithToken(refreshToken: string): Promise<CodexTokenPayload | null> {
  const oauth = getOauthConfig()
  if (!oauth.clientId) return null

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: oauth.clientId,
    refresh_token: refreshToken,
  })

  const res = await fetch(oauth.tokenUrl, {
    method: "POST",
    headers: getTokenRequestHeaders(),
    body,
    cache: "no-store",
  })

  if (!res.ok) return null
  return await res.json() as CodexTokenPayload
}

export async function clearCodexSession() {
  const cookieStore = await cookies()
  cookieStore.delete(CODEX_COOKIE_NAMES.accessToken)
  cookieStore.delete(CODEX_COOKIE_NAMES.refreshToken)
  cookieStore.delete(CODEX_COOKIE_NAMES.expiresAt)
}

export async function getValidAccessToken(forceRefresh = false): Promise<string | null> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(CODEX_COOKIE_NAMES.accessToken)?.value
  const refreshToken = cookieStore.get(CODEX_COOKIE_NAMES.refreshToken)?.value
  const expiresAtRaw = cookieStore.get(CODEX_COOKIE_NAMES.expiresAt)?.value
  const expiresAt = Number.parseInt(expiresAtRaw ?? "0", 10)

  if (!forceRefresh && accessToken && Number.isFinite(expiresAt) && !tokenExpiresSoon(expiresAt)) {
    return accessToken
  }

  if (!refreshToken) {
    return null
  }

  const refreshed = await refreshWithToken(refreshToken)
  if (!refreshed?.access_token) {
    await clearCodexSession()
    return null
  }

  const nextRefreshToken = refreshed.refresh_token ?? refreshToken
  const expiresAtNext = resolveExpiry(refreshed.access_token, refreshed.expires_in)
  const accessMaxAge = Math.max(30, expiresAtNext - nowEpochSeconds())

  cookieStore.set(CODEX_COOKIE_NAMES.accessToken, refreshed.access_token, getCodexCookieOptions(accessMaxAge))
  cookieStore.set(CODEX_COOKIE_NAMES.expiresAt, String(expiresAtNext), getCodexCookieOptions(accessMaxAge))
  cookieStore.set(CODEX_COOKIE_NAMES.refreshToken, nextRefreshToken, getCodexCookieOptions(60 * 60 * 24 * 30))

  return refreshed.access_token
}

export async function getAccountIdFromAccessToken(): Promise<string | null> {
  const accessToken = await getValidAccessToken(false)
  if (!accessToken) return null

  const payload = decodeJwtPayload<JwtWithExp & { "https://api.openai.com/profile"?: { id?: string } }>(accessToken)
  if (!payload) return null

  const profileId = payload["https://api.openai.com/profile"]?.id
  if (profileId) return profileId

  return payload.sub ?? null
}
