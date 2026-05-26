import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { getValidGeminiToken } from "@/lib/gemini-auth"
import { GEMINI_COOKIE_NAMES, getGeminiOauthConfig, getGeminiRedirectUri } from "@/lib/gemini-oauth"

type TokenInfoResponse = {
  scope?: string
  aud?: string
  azp?: string
  expires_in?: string
  email?: string
  error?: string
  error_description?: string
}

function resolveQuotaProject() {
  return process.env.GOOGLE_CLOUD_PROJECT
    ?? process.env.GOOGLE_PROJECT_ID
    ?? process.env.GCP_PROJECT
    ?? null
}

export async function GET(req: NextRequest) {
  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1"
  const token = await getValidGeminiToken(forceRefresh)
  const cookieStore = await cookies()
  const oauth = getGeminiOauthConfig()
  const configuredScopes = oauth.scope.split(/\s+/).filter(Boolean)
  const quotaProject = resolveQuotaProject()

  if (!token) {
    return NextResponse.json({
      authenticated: false,
      hasRefreshToken: Boolean(cookieStore.get(GEMINI_COOKIE_NAMES.refreshToken)?.value),
      expiresAt: cookieStore.get(GEMINI_COOKIE_NAMES.expiresAt)?.value ?? null,
      hasStateCookie: Boolean(cookieStore.get(GEMINI_COOKIE_NAMES.state)?.value),
      hasVerifierCookie: Boolean(cookieStore.get(GEMINI_COOKIE_NAMES.verifier)?.value),
      lastOauthStatus: cookieStore.get("gemini_debug_last_status")?.value ?? null,
      lastOauthDetail: cookieStore.get("gemini_debug_last_detail")?.value ?? null,
      configuredScopes,
      quotaProject,
      redirectUri: getGeminiRedirectUri(),
      clientIdConfigured: Boolean(oauth.clientId),
      clientSecretConfigured: Boolean(oauth.clientSecret),
    })
  }

  let tokenInfo: TokenInfoResponse | null = null
  let tokenInfoStatus: number | null = null

  try {
    const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    })

    tokenInfoStatus = tokenInfoRes.status
    tokenInfo = await tokenInfoRes.json() as TokenInfoResponse
  } catch {
    tokenInfo = null
  }

  const grantedScopes = tokenInfo?.scope?.split(/\s+/).filter(Boolean) ?? []
  const missingScopes = configuredScopes.filter((scope) => !grantedScopes.includes(scope))

  return NextResponse.json({
    authenticated: true,
    forcedRefresh: forceRefresh,
    quotaProject,
    redirectUri: getGeminiRedirectUri(),
    configuredScopes,
    grantedScopes,
    missingScopes,
    hasRefreshToken: Boolean(cookieStore.get(GEMINI_COOKIE_NAMES.refreshToken)?.value),
    expiresAt: cookieStore.get(GEMINI_COOKIE_NAMES.expiresAt)?.value ?? null,
    hasStateCookie: Boolean(cookieStore.get(GEMINI_COOKIE_NAMES.state)?.value),
    hasVerifierCookie: Boolean(cookieStore.get(GEMINI_COOKIE_NAMES.verifier)?.value),
    lastOauthStatus: cookieStore.get("gemini_debug_last_status")?.value ?? null,
    lastOauthDetail: cookieStore.get("gemini_debug_last_detail")?.value ?? null,
    tokenInfoStatus,
    tokenInfo,
    clientIdConfigured: Boolean(oauth.clientId),
    clientSecretConfigured: Boolean(oauth.clientSecret),
  })
}
