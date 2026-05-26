import { createHash, randomBytes } from "node:crypto"

export const CODEX_COOKIE_NAMES = {
  state: "codex_oauth_state",
  verifier: "codex_pkce_verifier",
  accessToken: "codex_access_token",
  refreshToken: "codex_refresh_token",
  expiresAt: "codex_access_expires_at",
} as const

export type CodexTokenPayload = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

export function createRandomBase64Url(size = 32): string {
  return randomBytes(size).toString("base64url")
}

export function createPkcePair() {
  const verifier = createRandomBase64Url(48)
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

export function isProductionEnv() {
  return process.env.NODE_ENV === "production"
}

export function resolveBaseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
}

function normalizeScopes(value: string | undefined) {
  return (
    value ??
    "openid profile email offline_access api.connectors.read api.connectors.invoke"
  )
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ")
}

export function getOauthConfig() {
  return {
    clientId: process.env.OPENAI_OAUTH_CLIENT_ID ?? "",
    authorizeUrl: process.env.OPENAI_OAUTH_AUTHORIZE_URL ?? "https://auth.openai.com/authorize",
    deviceCodeUrl: process.env.OPENAI_OAUTH_DEVICE_CODE_URL ?? "https://auth.openai.com/oauth/device/code",
    tokenUrl: process.env.OPENAI_OAUTH_TOKEN_URL ?? "https://auth.openai.com/oauth/token",
    scope: normalizeScopes(process.env.OPENAI_OAUTH_SCOPES),
    originator: process.env.OPENAI_OAUTH_ORIGINATOR ?? "codex_cli_rs",
  }
}

export function getCodexUserAgent(): string {
  const version = process.env.OPENAI_OAUTH_UA_VERSION ?? "0.3.0"
  const originator = process.env.OPENAI_OAUTH_ORIGINATOR ?? "codex_cli_rs"
  return `${originator}/${version} (Windows x86_64; NT 10.0) codex-tui (cli; 0.0.0)`
}

export function getTokenRequestHeaders(): HeadersInit {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": getCodexUserAgent(),
    Accept: "application/json",
  }
}

export function getCodexResponsesUrl() {
  return process.env.OPENAI_CODEX_RESPONSES_URL ?? "https://chatgpt.com/backend-api/codex/responses"
}

export function getRedirectUri() {
  return process.env.OPENAI_OAUTH_REDIRECT_URI ?? `${resolveBaseUrl()}/api/auth/gpt/callback`
}

export function decodeJwtPayload<T extends object = Record<string, unknown>>(token: string): T | null {
  const parts = token.split(".")
  if (parts.length < 2) return null

  try {
    const payload = parts[1]
    const json = Buffer.from(payload, "base64url").toString("utf-8")
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

export function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000)
}

export function tokenExpiresSoon(expiresAt: number, safetyWindowSeconds = 30): boolean {
  return nowEpochSeconds() >= (expiresAt - safetyWindowSeconds)
}
