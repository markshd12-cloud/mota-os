import { NextRequest, NextResponse } from "next/server"
import { GEMINI_COOKIE_NAMES } from "@/lib/gemini-oauth"

export async function GET(req: NextRequest) {
  const origin   = req.nextUrl.origin
  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/chat"
  const safePath = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/chat"

  const response = NextResponse.redirect(`${origin}${safePath}`)
  response.cookies.delete(GEMINI_COOKIE_NAMES.accessToken)
  response.cookies.delete(GEMINI_COOKIE_NAMES.refreshToken)
  response.cookies.delete(GEMINI_COOKIE_NAMES.expiresAt)
  response.cookies.delete(GEMINI_COOKIE_NAMES.state)
  response.cookies.delete(GEMINI_COOKIE_NAMES.verifier)
  response.cookies.delete("gemini_return_to")

  return response
}
