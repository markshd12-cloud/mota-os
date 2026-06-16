import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { logActivity }       from "@/lib/activity-logger"
import { rateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl  = rateLimit(`auth-login:${ip}`, RATE_LIMITS.authLogin)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Muitas tentativas. Tente novamente em ${Math.ceil(rl.resetIn / 60)} minutos.` },
      { status: 429, headers: { "Retry-After": String(rl.resetIn) } },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    new_password:     string
    confirm_password: string
  }

  const { new_password, confirm_password } = body

  // ── Validações ────────────────────────────────────────────────────────────────
  if (!new_password || new_password.length < 8) {
    return NextResponse.json({ error: "A senha deve ter pelo menos 8 caracteres." }, { status: 400 })
  }
  if (!/[a-zA-Z]/.test(new_password)) {
    return NextResponse.json({ error: "A senha deve conter pelo menos uma letra." }, { status: 400 })
  }
  if (!/[0-9]/.test(new_password)) {
    return NextResponse.json({ error: "A senha deve conter pelo menos um número." }, { status: 400 })
  }
  if (new_password !== confirm_password) {
    return NextResponse.json({ error: "As senhas não coincidem." }, { status: 400 })
  }

  // ── Atualizar senha via Supabase Auth ─────────────────────────────────────────
  const { error } = await supabase.auth.updateUser({ password: new_password })

  if (error) {
    const friendly =
      error.message.includes("same password")
        ? "A nova senha não pode ser igual à senha atual."
        : error.message.includes("rate limit") || error.message.includes("too many")
          ? "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente."
          : error.message

    void logActivity({
      userId:    user.id,
      eventType: "auth",
      action:    "security_password_change_failed",
      detail:    friendly,
    })

    return NextResponse.json({ error: friendly }, { status: 400 })
  }

  // ── Limpar flag de troca obrigatória, se ativo ────────────────────────────────
  // Executa em paralelo — nunca bloqueia o retorno ao usuário
  const admin = createAdminClient()
  const now = new Date().toISOString()

  void Promise.all([
    admin
      .from("profiles")
      .update({ must_change_password: false, first_access_at: now, updated_at: now })
      .eq("id", user.id)
      .eq("must_change_password", true),   // no-op se já false
    admin.auth.admin.updateUserById(user.id, {
      app_metadata: { must_change_password: false },
    }),
  ])

  void logActivity({
    userId:    user.id,
    eventType: "auth",
    action:    "security_password_changed",
    detail:    "Senha alterada com sucesso na área logada",
  })

  return NextResponse.json({ ok: true, cleared_must_change: true })
}
