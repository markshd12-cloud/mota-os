import { type NextRequest, NextResponse } from "next/server"
import {
  CODEX_COOKIE_NAMES,
  getOauthConfig,
  getTokenRequestHeaders,
  nowEpochSeconds,
  type CodexTokenPayload,
} from "@/lib/codex-oauth"
import { getCodexCookieOptions } from "@/lib/codex-cookies"

type DevicePollBody = {
  device_code?: string
}

type OAuthErrorResponse = {
  error?: string
  error_description?: string
}

function tokenExpiresAt(accessToken: string, expiresIn?: number): number {
  if (expiresIn && Number.isFinite(expiresIn)) {
    return nowEpochSeconds() + expiresIn
  }

  try {
    const [, payloadRaw] = accessToken.split(".")
    if (!payloadRaw) return nowEpochSeconds() + 3600
    const payload = JSON.parse(Buffer.from(payloadRaw, "base64url").toString("utf-8")) as { exp?: number }
    if (payload.exp && Number.isFinite(payload.exp)) {
      return payload.exp
    }
  } catch {
    // fallback para 1h quando o token não for JWT parseável
  }

  return nowEpochSeconds() + 3600
}

function normalizePending(error: string | undefined) {
  if (error === "authorization_pending") return "pending"
  if (error === "slow_down") return "slow_down"
  if (error === "expired_token") return "expired"
  if (error === "access_denied") return "denied"
  return "error"
}

export async function POST(req: NextRequest) {
  const oauth = getOauthConfig()
  if (!oauth.clientId) {
    return NextResponse.json({ error: "OPENAI_OAUTH_CLIENT_ID não configurado" }, { status: 500 })
  }

  let bodyJson: DevicePollBody
  try {
    bodyJson = await req.json() as DevicePollBody
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }

  const deviceCode = bodyJson.device_code?.trim()
  if (!deviceCode) {
    return NextResponse.json({ error: "device_code é obrigatório" }, { status: 400 })
  }

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: oauth.clientId,
    device_code: deviceCode,
  })

  const tokenRes = await fetch(oauth.tokenUrl, {
    method: "POST",
    headers: getTokenRequestHeaders(),
    body,
    cache: "no-store",
  })

  if (!tokenRes.ok) {
    let payload: OAuthErrorResponse | null = null
    try {
      payload = await tokenRes.json() as OAuthErrorResponse
    } catch {
      // Ignora parse e retorna erro genérico em seguida.
    }

    const status = normalizePending(payload?.error)
    if (status === "pending" || status === "slow_down" || status === "expired" || status === "denied") {
      return NextResponse.json({
        status,
        error: payload?.error ?? "oauth_error",
        error_description: payload?.error_description,
      })
    }

    return NextResponse.json(
      {
        status: "error",
        error: payload?.error ?? "oauth_error",
        error_description: payload?.error_description ?? "Falha ao trocar device_code por token",
      },
      { status: 502 },
    )
  }

  const tokenData = await tokenRes.json() as CodexTokenPayload
  if (!tokenData.access_token) {
    return NextResponse.json({ status: "error", error: "missing_access_token" }, { status: 502 })
  }

  const expiresAt = tokenExpiresAt(tokenData.access_token, tokenData.expires_in)
  const accessMaxAge = Math.max(30, expiresAt - nowEpochSeconds())

  const response = NextResponse.json({ status: "authorized" })
  response.cookies.set(CODEX_COOKIE_NAMES.accessToken, tokenData.access_token, getCodexCookieOptions(accessMaxAge))
  response.cookies.set(CODEX_COOKIE_NAMES.expiresAt, String(expiresAt), getCodexCookieOptions(accessMaxAge))

  if (tokenData.refresh_token) {
    response.cookies.set(CODEX_COOKIE_NAMES.refreshToken, tokenData.refresh_token, getCodexCookieOptions(60 * 60 * 24 * 30))
  }

  response.cookies.delete(CODEX_COOKIE_NAMES.state)
  response.cookies.delete(CODEX_COOKIE_NAMES.verifier)

  return response
}
