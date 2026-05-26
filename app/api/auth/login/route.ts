import { NextRequest, NextResponse } from "next/server"
import {
  CODEX_COOKIE_NAMES,
  createPkcePair,
  createRandomBase64Url,
  getOauthConfig,
  getRedirectUri,
  isProductionEnv,
} from "@/lib/codex-oauth"

export async function GET(req: NextRequest) {
  const oauth = getOauthConfig()
  if (!oauth.clientId) {
    return NextResponse.json({ error: "OPENAI_OAUTH_CLIENT_ID não configurado" }, { status: 500 })
  }

  const { verifier, challenge } = createPkcePair()
  const state = createRandomBase64Url(24)
  const redirectUri = getRedirectUri()
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/"

  const authorizeUrl = new URL(oauth.authorizeUrl)
  authorizeUrl.searchParams.set("client_id", oauth.clientId)
  authorizeUrl.searchParams.set("scope", oauth.scope)
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("code_challenge", challenge)
  authorizeUrl.searchParams.set("code_challenge_method", "S256")
  authorizeUrl.searchParams.set("id_token_add_organizations", "true")
  authorizeUrl.searchParams.set("codex_cli_simplified_flow", "true")
  authorizeUrl.searchParams.set("originator", oauth.originator)
  authorizeUrl.searchParams.set("state", state)

  const response = NextResponse.redirect(authorizeUrl)
  const secure = isProductionEnv()

  response.cookies.set(CODEX_COOKIE_NAMES.verifier, verifier, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  })

  response.cookies.set(CODEX_COOKIE_NAMES.state, state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  })

  response.cookies.set("codex_return_to", returnTo, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  })

  return response
}
