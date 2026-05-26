import { NextRequest, NextResponse } from "next/server"
import {
  GEMINI_COOKIE_NAMES,
  createPkcePair,
  createRandomBase64Url,
  getGeminiOauthConfig,
  getGeminiRedirectUri,
  isProductionEnv,
} from "@/lib/gemini-oauth"

export async function GET(req: NextRequest) {
  const oauth = getGeminiOauthConfig()
  if (!oauth.clientId) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID não configurado" }, { status: 500 })
  }

  const { verifier, challenge } = createPkcePair()
  const state    = createRandomBase64Url(24)
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/"

  const authorizeUrl = new URL(oauth.authorizeUrl)
  authorizeUrl.searchParams.set("client_id",             oauth.clientId)
  authorizeUrl.searchParams.set("redirect_uri",          getGeminiRedirectUri())
  authorizeUrl.searchParams.set("response_type",         "code")
  authorizeUrl.searchParams.set("scope",                 oauth.scope)
  authorizeUrl.searchParams.set("state",                 state)
  authorizeUrl.searchParams.set("code_challenge",        challenge)
  authorizeUrl.searchParams.set("code_challenge_method", "S256")
  authorizeUrl.searchParams.set("access_type",           "offline")
  authorizeUrl.searchParams.set("prompt",                "consent")

  const secure   = isProductionEnv()
  const response = NextResponse.redirect(authorizeUrl)

  response.cookies.set("gemini_debug_last_status", "login_started", {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 30,
  })
  response.cookies.set("gemini_debug_last_detail", `returnTo=${encodeURIComponent(returnTo)}`, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 30,
  })

  response.cookies.set(GEMINI_COOKIE_NAMES.verifier, verifier, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 10,
  })
  response.cookies.set(GEMINI_COOKIE_NAMES.state, state, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 10,
  })
  response.cookies.set("gemini_return_to", encodeURIComponent(returnTo), {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 10,
  })

  return response
}
