import { createHash, randomBytes } from "node:crypto"

export const GEMINI_COOKIE_NAMES = {
  state:        "gemini_oauth_state",
  verifier:     "gemini_pkce_verifier",
  accessToken:  "gemini_access_token",
  refreshToken: "gemini_refresh_token",
  expiresAt:    "gemini_access_expires_at",
} as const

export type GeminiTokenPayload = {
  access_token:   string
  refresh_token?: string
  expires_in?:    number
  token_type?:    string
  id_token?:      string
}

export function createRandomBase64Url(size = 32): string {
  return randomBytes(size).toString("base64url")
}

export function createPkcePair() {
  const verifier  = createRandomBase64Url(48)
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

export function isProductionEnv() {
  return process.env.NODE_ENV === "production"
}

export function resolveBaseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
}

export function getGeminiOauthConfig() {
  return {
    clientId:     process.env.GOOGLE_CLIENT_ID     ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl:     "https://oauth2.googleapis.com/token",
    scope: [
      "openid",
      "email",
      "profile",
      // Escopo exigido pela Generative Language API com user OAuth.
      // Requer: API habilitada no projeto + usuário com roles/serviceusage.serviceUsageConsumer.
      "https://www.googleapis.com/auth/cloud-platform",
    ].join(" "),
  }
}

export function getGeminiRedirectUri() {
  return `${resolveBaseUrl()}/api/auth/google/callback`
}

export function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000)
}

export function tokenExpiresSoon(expiresAt: number, safetyWindowSeconds = 60): boolean {
  return nowEpochSeconds() >= (expiresAt - safetyWindowSeconds)
}
