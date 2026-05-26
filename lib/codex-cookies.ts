import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies"
import { isProductionEnv } from "@/lib/codex-oauth"

export const CODEX_COOKIE_OPTIONS: Omit<ResponseCookie, "name" | "value"> = {
  httpOnly: true,
  secure: isProductionEnv(),
  sameSite: "lax",
  path: "/",
}

export function getCodexCookieOptions(maxAge: number): Omit<ResponseCookie, "name" | "value"> {
  return {
    ...CODEX_COOKIE_OPTIONS,
    maxAge,
  }
}
