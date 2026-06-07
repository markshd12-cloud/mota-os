import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { rateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl  = rateLimit(`auth-reset:${ip}`, RATE_LIMITS.authReset)

  if (!rl.ok) {
    const retryMin = Math.ceil(rl.resetIn / 60)
    return new NextResponse(
      JSON.stringify({
        error: `Muitas tentativas de recuperação. Tente novamente em ${retryMin} minuto${retryMin > 1 ? "s" : ""}.`,
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

  const body = await req.json() as { email?: string; redirectTo?: string }
  const { email, redirectTo } = body

  if (!email) {
    return NextResponse.json({ error: "E-mail é obrigatório." }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: redirectTo ?? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/reset-password`,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
