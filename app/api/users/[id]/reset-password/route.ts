import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin }     from "@/lib/company-scope"
import { logActivity }       from "@/lib/activity-logger"
import { denyAccess }        from "@/lib/api-guard"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  if (!await isGlobalAdmin(user.id)) {
    return denyAccess({ req, userId: user.id, reason: "not_admin" })
  }

  const { id: targetId } = await params
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from("profiles")
    .select("email, name")
    .eq("id", targetId)
    .single()

  if (!profile?.email) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 })
  }

  const origin = req.headers.get("origin")
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? ""

  // generateLink gera o link de recuperação e tenta enviar por e-mail (via SMTP,
  // se configurado). O action_link é retornado para o admin copiar e enviar
  // manualmente (WhatsApp etc.) quando o SMTP ainda não estiver configurado.
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: profile.email,
    options: { redirectTo: `${origin}/reset-password` },
  })

  if (linkError) {
    console.error("[users/reset-password] generateLink error:", linkError.message)
    return NextResponse.json(
      { error: "Erro ao gerar link de reset." },
      { status: 500 },
    )
  }

  const actionLink = linkData?.properties?.action_link ?? null

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "user_password_reset_sent",
    detail:    `Reset de senha gerado para ${profile.email}`,
    metadata:  { target_user_id: targetId },
  })

  return NextResponse.json({
    ok: true,
    link: actionLink,
    message: `Link de acesso gerado para ${profile.email}. Se o e-mail não chegar, copie o link abaixo e envie ao usuário.`,
  })
}
