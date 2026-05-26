import { NextResponse } from "next/server"
import { getValidAccessToken } from "@/lib/codex-auth"

export async function GET() {
  const token = await getValidAccessToken(false)

  return NextResponse.json({
    authenticated: Boolean(token),
    provider: "openai-oauth",
  })
}
