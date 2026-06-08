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
  console.log(`[send-magic-link] POST ip=${ip}`)

  if (isAuthRateLimitEnabled()) {
    const rl = rateLimit(`auth_magic_link:${ip}`, RATE_LIMITS.auth_magic_link)
    if (!rl.ok) {
      console.warn(`[send-magic-link] rate-limited ip=${ip}`)
      return rateLimitResponse(rl.resetAt)
    }
  }

  let body: { email?: string }
  try {
    body = await req.json() as { email?: string }
  } catch {
    console.error("[send-magic-link] body parse error")
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 })
  }

  const email = body.email?.toLowerCase().trim()
  if (!email || !email.includes("@")) {
    console.warn(`[send-magic-link] invalid email: "${email}"`)
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 })
  }

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    console.error("[send-magic-link] Supabase env vars missing")
    return NextResponse.json({ error: "Erro de configuração do servidor." }, { status: 500 })
  }

  const origin     = getOrigin(req)
  // PKCE: o email sempre aponta para /auth/callback que faz o exchangeCodeForSession server-side.
  const redirectTo = `${origin}/auth/callback`
  console.log(`[send-magic-link] email=${email} origin=${origin} redirectTo=${redirectTo}`)

  // O response é criado antes do signInWithOtp para que os cookies do code_verifier
  // sejam escritos neste mesmo objeto e devolvidos ao browser.
  // O browser armazena o cookie e o envia de volta no GET de /auth/callback,
  // onde exchangeCodeForSession o usa para completar o PKCE.
  const response = NextResponse.json({ ok: true })

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          console.log(`[send-magic-link] set cookie: ${name}`)
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })

    if (error) {
      console.error(`[send-magic-link] supabase error: ${error.message} (status=${error.status})`)
      const msg = error.message.includes("rate limit") || error.message.includes("too many")
        ? "Muitas solicitações de link mágico para este e-mail. Aguarde alguns minutos."
        : "Não foi possível enviar o link. Tente novamente em alguns instantes."
      return NextResponse.json({ error: msg }, { status: 429 })
    }

    console.log(`[send-magic-link] OK email=${email}`)
    return response  // inclui o cookie com o code_verifier PKCE
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[send-magic-link] unexpected error: ${msg}`)
    return NextResponse.json(
      { error: "Erro interno ao enviar link. Verifique as variáveis de ambiente." },
      { status: 500 },
    )
  }
}
