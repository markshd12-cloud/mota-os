import { NextRequest, NextResponse } from "next/server"
import { createClient }    from "@/lib/supabase-server"
import { rateLimit, rateLimitResponse, getClientIp, RATE_LIMITS } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl  = rateLimit(`auth-login:${ip}`, RATE_LIMITS.authLogin)

  if (!rl.ok) {
    const retryMin = Math.ceil(rl.resetIn / 60)
    return new NextResponse(
      JSON.stringify({
        error: `Muitas tentativas de login. Tente novamente em ${retryMin} minuto${retryMin > 1 ? "s" : ""}.`,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After":  String(rl.resetIn),
        },
      },
    )
  }

  const body = await req.json() as { email?: string; password?: string }
  const { email, password } = body

  if (!email || !password) {
    return NextResponse.json({ error: "E-mail e senha são obrigatórios." }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    const message =
      error.message === "Invalid login credentials"
        ? "E-mail ou senha incorretos."
        : error.message
    return NextResponse.json({ error: message }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}
