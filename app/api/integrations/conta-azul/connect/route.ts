import { NextResponse }  from "next/server"
import { cookies }        from "next/headers"
import { createClient }   from "@/lib/supabase-server"
import { isGlobalAdmin }  from "@/lib/company-scope"
import crypto             from "crypto"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const adminUser = await isGlobalAdmin(user.id)
  if (!adminUser) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })

  const redirectUri = process.env.CONTA_AZUL_REDIRECT_URI
  if (!redirectUri) {
    return NextResponse.json({ error: "CONTA_AZUL_REDIRECT_URI não configurado" }, { status: 500 })
  }

  const clientId = process.env.CONTA_AZUL_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: "CONTA_AZUL_CLIENT_ID não configurado" }, { status: 500 })
  }

  const authUrl     = process.env.CONTA_AZUL_AUTH_URL || "https://auth.contaazul.com/login"
  const state       = crypto.randomBytes(32).toString("hex")
  // Caminho relativo para onde o usuário volta após o callback — nunca URL absoluta com localhost
  const redirectAfter = "/settings?tab=apis&provider=conta_azul"

  const cookieStore = await cookies()

  // State CSRF — httpOnly, 10 min
  cookieStore.set("conta_azul_oauth_state", state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   60 * 10,
    path:     "/",
  })

  // Redirect path — somente relativo, nunca localhost
  cookieStore.set("conta_azul_oauth_redirect", redirectAfter, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   60 * 10,
    path:     "/",
  })

  const params = new URLSearchParams({
    response_type: "code",
    client_id:     clientId,
    redirect_uri:  redirectUri,
    state,
  })

  const scope = process.env.CONTA_AZUL_SCOPE
  if (scope) params.set("scope", scope)

  const fullUrl = `${authUrl}?${params.toString()}`

  return NextResponse.redirect(fullUrl)
}
