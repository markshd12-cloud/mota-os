import { type NextRequest, NextResponse } from "next/server"
import {
  CODEX_COOKIE_NAMES,
  getOauthConfig,
  getTokenRequestHeaders,
  isProductionEnv,
  nowEpochSeconds,
  type CodexTokenPayload,
} from "@/lib/codex-oauth"
import { getCodexCookieOptions } from "@/lib/codex-cookies"

const RETURN_TO_COOKIE = "codex_return_to"

function safeReturnTo(value: string | undefined): string {
  if (!value) return "/chat"
  if (!value.startsWith("/")) return "/chat"
  if (value.startsWith("//")) return "/chat"
  return value
}

function parseCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined
  return cookieHeader
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function tokenExpiresAt(accessToken: string, expiresIn?: number): number {
  if (expiresIn && Number.isFinite(expiresIn)) {
    return nowEpochSeconds() + expiresIn
  }
  try {
    const [, raw] = accessToken.split(".")
    const payload = JSON.parse(Buffer.from(raw ?? "", "base64url").toString("utf-8")) as { exp?: number }
    if (payload.exp && Number.isFinite(payload.exp)) return payload.exp
  } catch { /* fallback */ }
  return nowEpochSeconds() + 3600
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const oauthError = searchParams.get("error")
  const oauthErrorDesc = searchParams.get("error_description")

  const cookieHeader = request.headers.get("cookie")
  const stateCookie = parseCookie(cookieHeader, CODEX_COOKIE_NAMES.state)
  const verifierCookie = parseCookie(cookieHeader, CODEX_COOKIE_NAMES.verifier)
  const returnToRaw = parseCookie(cookieHeader, RETURN_TO_COOKIE)
  const returnTo = safeReturnTo(returnToRaw ? decodeURIComponent(returnToRaw) : undefined)

  function errorRedirect(msg: string) {
    const dest = new URL(`${origin}${returnTo}`)
    dest.searchParams.set("gpt_error", msg)
    const res = NextResponse.redirect(dest)
    res.cookies.delete(CODEX_COOKIE_NAMES.state)
    res.cookies.delete(CODEX_COOKIE_NAMES.verifier)
    res.cookies.delete(RETURN_TO_COOKIE)
    return res
  }

  // O provedor retornou um erro antes de gerar o código.
  if (oauthError) {
    return errorRedirect(oauthErrorDesc ?? oauthError)
  }

  if (!code) {
    return errorRedirect("Nenhum código de autorização recebido.")
  }
  if (!state) {
    return errorRedirect("Parâmetro de estado ausente no callback.")
  }
  if (!stateCookie) {
    return errorRedirect("Cookie de estado não encontrado. Limpe os cookies e tente novamente.")
  }
  if (stateCookie !== state) {
    return errorRedirect("Estado OAuth inválido. Possível CSRF — inicie o login novamente.")
  }
  if (!verifierCookie) {
    return errorRedirect("Cookie de verificador PKCE não encontrado. Limpe os cookies e tente novamente.")
  }

  const oauth = getOauthConfig()
  if (!oauth.clientId) {
    return errorRedirect("OPENAI_OAUTH_CLIENT_ID não configurado no servidor.")
  }

  const redirectUri = `${origin}/api/auth/gpt/callback`

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: oauth.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifierCookie,
  })

  const tokenRes = await fetch(oauth.tokenUrl, {
    method: "POST",
    headers: getTokenRequestHeaders(),
    body,
    cache: "no-store",
  })

  if (!tokenRes.ok) {
    let detail = ""
    try {
      const errBody = await tokenRes.json() as { error?: string; error_description?: string }
      detail = errBody.error_description ?? errBody.error ?? ""
    } catch { /* ignore */ }
    return errorRedirect(
      `Falha na troca de token (${tokenRes.status})${detail ? `: ${detail}` : ""}.`
    )
  }

  const tokenData = await tokenRes.json() as CodexTokenPayload
  if (!tokenData.access_token) {
    return errorRedirect("Resposta do servidor de token não contém access_token.")
  }

  const expiresAt = tokenExpiresAt(tokenData.access_token, tokenData.expires_in)
  const accessMaxAge = Math.max(30, expiresAt - nowEpochSeconds())
  const secure = isProductionEnv()

  const response = NextResponse.redirect(`${origin}${returnTo}`)

  response.cookies.set(CODEX_COOKIE_NAMES.accessToken, tokenData.access_token, getCodexCookieOptions(accessMaxAge))
  response.cookies.set(CODEX_COOKIE_NAMES.expiresAt, String(expiresAt), getCodexCookieOptions(accessMaxAge))

  if (tokenData.refresh_token) {
    response.cookies.set(
      CODEX_COOKIE_NAMES.refreshToken,
      tokenData.refresh_token,
      getCodexCookieOptions(60 * 60 * 24 * 30),
    )
  }

  response.cookies.delete(CODEX_COOKIE_NAMES.state)
  response.cookies.delete(CODEX_COOKIE_NAMES.verifier)
  response.cookies.delete(RETURN_TO_COOKIE)

  if (!secure) {
    // Em desenvolvimento não há `secure`, garantir que o browser aceita os cookies
    // definindo-os explicitamente sem o flag.
    response.cookies.set(CODEX_COOKIE_NAMES.accessToken, tokenData.access_token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: accessMaxAge,
    })
    response.cookies.set(CODEX_COOKIE_NAMES.expiresAt, String(expiresAt), {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: accessMaxAge,
    })
    if (tokenData.refresh_token) {
      response.cookies.set(CODEX_COOKIE_NAMES.refreshToken, tokenData.refresh_token, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      })
    }
  }

  return response
}
