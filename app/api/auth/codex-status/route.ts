import { NextResponse } from "next/server"
import { getValidAccessToken } from "@/lib/codex-auth"
import { createClient } from "@/lib/supabase-server"
import { isGlobalAdmin } from "@/lib/company-scope"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 })
  }
  if (!(await isGlobalAdmin(user.id))) {
    return NextResponse.json({ error: "Apenas admin." }, { status: 403 })
  }

  const token = await getValidAccessToken(false)

  return NextResponse.json({
    authenticated: Boolean(token),
    provider: "openai-oauth",
  })
}
