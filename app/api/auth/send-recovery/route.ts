import { NextRequest, NextResponse } from "next/server"
import { createServerClient }        from "@supabase/ssr"
import {
  rateLimit,
  rateLimitResponse,
  getClientIp,
  isAuthRateLimitEnabled,
  RATE_LIMITS,
} from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// Deriva o origin da URL da própria request — sempre correto em qualquer ambiente.
function getOrigin(req: NextRequest): string {
  const header = req.headers.get("origin")
  if (header) return header
  const u = new URL(req.url)
  return `${u.protocol}//${u.host}`
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  console.log(`[send-recovery] POST ip=${ip}`)

  if (isAuthRateLimitEnabled()) {
    const rl = rateLimit(`auth_recovery:${ip}`, RATE_LIMITS.auth_recovery)
    if (!rl.ok) {
      console.warn(`[send-recovery] rate-limited ip=${ip}`)
      return rateLimitResponse(rl.resetAt)
    }
  }

  let body: { email?: string }
  try {
    body = await req.json() as { email?: string }
  } catch {
    console.error("[send-recovery] body parse error")
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 })
  }

  const email = body.email?.toLowerCase().trim()
  if (!email || !email.includes("@")) {
    console.warn(`[send-recovery] invalid email: "${email}"`)
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 })
  }

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    console.error("[send-recovery] Supabase env vars missing")
    return NextResponse.json({ error: "Erro de configuração do servidor." }, { status: 500 })
  }

  const origin = getOrigin(req)
  // PKCE: redirectTo aponta para /auth/callback (não /reset-password).
  // O callback troca o code server-side e redireciona para /reset-password sem code.
  // Isso garante que o code_verifier (em cookie) seja lido no mesmo contexto server-side.
  const redirectTo = `${origin}/auth/callback`
  console.log(`[send-recovery] email=${email} origin=${origin} redirectTo=${redirectTo}`)

  // O response é criado antes para capturar os cookies do code_verifier PKCE
  // escritos pelo createServerClient durante resetPasswordForEmail.
  const response = NextResponse.json({ ok: true })

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          console.log(`[send-recovery] set cookie: ${name}`)
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    })

    if (error) {
      console.error(`[send-recovery] supabase error: ${error.message} (status=${error.status})`)
      const msg = error.message.includes("rate limit") || error.message.includes("too many")
        ? "Muitas solicitações de recuperação para este e-mail. Aguarde alguns minutos."
        : "Não foi possível enviar o link. Tente novamente em alguns instantes."
      return NextResponse.json({ error: msg }, { status: 429 })
    }

    console.log(`[send-recovery] OK email=${email}`)
    // Resposta genérica — não revelar se o e-mail existe ou não
    return response  // inclui o cookie com o code_verifier PKCE
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[send-recovery] unexpected error: ${msg}`)
    return NextResponse.json(
      { error: "Erro interno ao enviar e-mail. Verifique as variáveis de ambiente." },
      { status: 500 },
    )
  }
}
