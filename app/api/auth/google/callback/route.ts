import { NextRequest, NextResponse } from "next/server"
import {
  GEMINI_COOKIE_NAMES,
  getGeminiOauthConfig,
  getGeminiRedirectUri,
  isProductionEnv,
  nowEpochSeconds,
  type GeminiTokenPayload,
} from "@/lib/gemini-oauth"

function safeReturnTo(value: string | undefined): string {
  if (!value) return "/chat"
  if (!value.startsWith("/")) return "/chat"
  if (value.startsWith("//")) return "/chat"
  return value
}

function cookieOptions(maxAge: number, secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge }
}

function setDebugCookies(response: NextResponse, status: string, detail: string, secure: boolean) {
  response.cookies.set("gemini_debug_last_status", status, cookieOptions(60 * 30, secure))
  response.cookies.set("gemini_debug_last_detail", detail, cookieOptions(60 * 30, secure))
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code           = searchParams.get("code")
  const state          = searchParams.get("state")
  const oauthError     = searchParams.get("error")
  const oauthErrorDesc = searchParams.get("error_description")

  const stateCookie    = req.cookies.get(GEMINI_COOKIE_NAMES.state)?.value
  const verifierCookie = req.cookies.get(GEMINI_COOKIE_NAMES.verifier)?.value
  const returnToRaw    = req.cookies.get("gemini_return_to")?.value
  const returnTo       = safeReturnTo(returnToRaw ? decodeURIComponent(returnToRaw) : undefined)

  function errorRedirect(msg: string) {
    const dest = new URL(`${origin}${returnTo}`)
    dest.searchParams.set("gemini_error", msg)
    const res = NextResponse.redirect(dest)
    setDebugCookies(res, "callback_error", msg, isProductionEnv())
    res.cookies.delete(GEMINI_COOKIE_NAMES.state)
    res.cookies.delete(GEMINI_COOKIE_NAMES.verifier)
    res.cookies.delete("gemini_return_to")
    return res
  }

  if (oauthError)          return errorRedirect(oauthErrorDesc ?? oauthError)
  if (!code)               return errorRedirect("Nenhum código de autorização recebido.")
  if (!state)              return errorRedirect("Parâmetro de estado ausente no callback.")
  if (!stateCookie)        return errorRedirect("Cookie de estado não encontrado.")
  if (stateCookie !== state) return errorRedirect("Estado OAuth inválido.")
  if (!verifierCookie)     return errorRedirect("Cookie de verificador PKCE não encontrado.")

  const oauth = getGeminiOauthConfig()
  if (!oauth.clientId || !oauth.clientSecret) {
    return errorRedirect("GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET não configurado.")
  }

  const tokenRes = await fetch(oauth.tokenUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      client_id:     oauth.clientId,
      client_secret: oauth.clientSecret,
      code,
      redirect_uri:  getGeminiRedirectUri(),
      code_verifier: verifierCookie,
    }),
    cache: "no-store",
  })

  if (!tokenRes.ok) {
    let detail = ""
    try {
      const errBody = await tokenRes.json() as { error?: string; error_description?: string }
      detail = errBody.error_description ?? errBody.error ?? ""
    } catch { /* ignore */ }
    return errorRedirect(`Falha na troca de token (${tokenRes.status})${detail ? `: ${detail}` : ""}`)
  }

  const tokenData = await tokenRes.json() as GeminiTokenPayload
  if (!tokenData.access_token) {
    return errorRedirect("Resposta do servidor de token não contém access_token.")
  }

  const expiresIn    = tokenData.expires_in ?? 3600
  const expiresAt    = nowEpochSeconds() + expiresIn
  const accessMaxAge = Math.max(30, expiresIn)
  const secure       = isProductionEnv()
  const response     = NextResponse.redirect(`${origin}${returnTo}`)
  const grantedScopes = req.nextUrl.searchParams.get("scope")

  response.cookies.set(GEMINI_COOKIE_NAMES.accessToken, tokenData.access_token, cookieOptions(accessMaxAge, secure))
  response.cookies.set(GEMINI_COOKIE_NAMES.expiresAt,   String(expiresAt),       cookieOptions(accessMaxAge, secure))

  if (tokenData.refresh_token) {
    response.cookies.set(
      GEMINI_COOKIE_NAMES.refreshToken,
      tokenData.refresh_token,
      cookieOptions(60 * 60 * 24 * 30, secure),
    )
  }

  response.cookies.delete(GEMINI_COOKIE_NAMES.state)
  response.cookies.delete(GEMINI_COOKIE_NAMES.verifier)
  response.cookies.delete("gemini_return_to")
  setDebugCookies(
    response,
    tokenData.refresh_token ? "callback_success_with_refresh" : "callback_success_without_refresh",
    grantedScopes ?? "scope_not_returned_by_google",
    secure,
  )

  return response
}
