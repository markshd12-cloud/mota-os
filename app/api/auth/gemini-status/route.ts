import { NextResponse } from "next/server"
import { getValidGeminiToken } from "@/lib/gemini-auth"

export async function GET() {
  const token = await getValidGeminiToken(false)
  return NextResponse.json({ authenticated: Boolean(token), provider: "google-oauth" })
}
