import { createClient } from "@/lib/supabase-server"
import { NextResponse }  from "next/server"

/**
 * Callback PKCE do Supabase Auth (Magic Link, Recovery, Invite).
 *
 * O code_verifier foi armazenado em cookie pelo /api/auth/send-magic-link
 * ou /api/auth/send-recovery (via createServerClient). O browser enviou esse
 * cookie de volta nesta request. createServerClient lê o verifier dos cookies
 * e o inclui automaticamente na chamada exchangeCodeForSession.
 *
 * Para todos os tipos (magic link, recovery, invite):
 *   1. Troca o code por uma sessão aqui (server-side, acesso ao cookie com verifier)
 *   2. Recovery → redireciona para /reset-password (sem code, já tem sessão)
 *   3. Outros → redireciona para /dashboard (ou ?next)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const type = searchParams.get("type")   // 'recovery' | 'magiclink' | 'invite' | null
  const next = searchParams.get("next") ?? "/dashboard"

  console.log(`[auth/callback] GET type=${type} code=${code ? "present" : "absent"}`)

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error(`[auth/callback] exchangeCodeForSession error: ${error.message}`)
      const url = new URL("/login", origin)
      url.searchParams.set("error", "link_inválido")
      return NextResponse.redirect(url.toString())
    }

    console.log(`[auth/callback] session established type=${type}`)
  }

  // Recovery: sessão de recovery estabelecida acima → vai para /reset-password.
  // A página usa a sessão ativa para chamar updateUser({ password }) diretamente.
  if (type === "recovery") {
    return NextResponse.redirect(`${origin}/reset-password`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
