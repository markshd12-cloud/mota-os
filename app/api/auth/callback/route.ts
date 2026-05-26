import { NextRequest, NextResponse } from "next/server"
import {
  CODEX_COOKIE_NAMES,
  getOauthConfig,
  getRedirectUri,
  isProductionEnv,
  nowEpochSeconds,
  type CodexTokenPayload,
} from "@/lib/codex-oauth"

const RETURN_TO_COOKIE = "codex_return_to"

function safeReturnTo(value: string | undefined) {
  if (!value) return "/"
  if (!value.startsWith("/")) return "/"
  if (value.startsWith("//")) return "/"
  return value
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")

  if (!code || !state) {
    return NextResponse.redirect(new URL("/?oauth_error=missing_code_or_state", req.url))
  }

  const stateCookie = req.cookies.get(CODEX_COOKIE_NAMES.state)?.value
  const verifier = req.cookies.get(CODEX_COOKIE_NAMES.verifier)?.value

  if (!stateCookie || stateCookie !== state || !verifier) {
    return NextResponse.redirect(new URL("/?oauth_error=invalid_state", req.url))
  }

  const oauth = getOauthConfig()
  if (!oauth.clientId) {
    return NextResponse.redirect(new URL("/?oauth_error=missing_client_id", req.url))
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: oauth.clientId,
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier,
  })

  const tokenRes = await fetch(oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL(`/?oauth_error=token_exchange_failed&status=${tokenRes.status}`, req.url))
  }

  const tokenData = await tokenRes.json() as CodexTokenPayload
  if (!tokenData.access_token) {
    return NextResponse.redirect(new URL("/?oauth_error=missing_access_token", req.url))
  }

  const secure = isProductionEnv()
  const expiresIn = tokenData.expires_in ?? 3600
  const expiresAt = nowEpochSeconds() + expiresIn
  const returnTo = safeReturnTo(req.cookies.get(RETURN_TO_COOKIE)?.value)
  const response = NextResponse.redirect(new URL(returnTo, req.url))

  response.cookies.set(CODEX_COOKIE_NAMES.accessToken, tokenData.access_token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: expiresIn,
  })

  if (tokenData.refresh_token) {
    response.cookies.set(CODEX_COOKIE_NAMES.refreshToken, tokenData.refresh_token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    })
  }

  response.cookies.set(CODEX_COOKIE_NAMES.expiresAt, String(expiresAt), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: expiresIn,
  })

  response.cookies.delete(CODEX_COOKIE_NAMES.state)
  response.cookies.delete(CODEX_COOKIE_NAMES.verifier)
  response.cookies.delete(RETURN_TO_COOKIE)

  return response
}
