import { NextRequest, NextResponse }  from "next/server"
import { createClient }              from "@/lib/supabase-server"
import { createAdminClient }         from "@/lib/supabase-admin"
import { getAllowedCompanyIds }       from "@/lib/company-scope"
import { logActivity }               from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

/**
 * POST /api/chat/regenerate
 * Encontra a mensagem de usuário anterior à mensagem assistente indicada
 * e retorna o contexto necessário para o cliente re-enviar para /api/chat.
 *
 * O cliente re-envia para /api/chat com o mesmo payload + regenerated_from_id.
 * Isso evita duplicar a lógica de stream neste endpoint.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    session_id:           string
    assistant_message_id: string
  }

  if (!body.session_id || !body.assistant_message_id) {
    return NextResponse.json({ error: "session_id e assistant_message_id são obrigatórios." }, { status: 400 })
  }

  const admin            = createAdminClient()
  const allowedCompanies = await getAllowedCompanyIds(user.id)

  // Valida que a sessão pertence ao usuário / empresa acessível
  const { data: session } = await admin
    .from("sessions")
    .select("id, company_id, agent_id")
    .eq("id", body.session_id)
    .maybeSingle()

  if (!session || !(allowedCompanies as string[]).includes(session.company_id as string)) {
    return NextResponse.json({ error: "Sem acesso a esta sessão." }, { status: 403 })
  }

  // Busca a mensagem do assistente e a do usuário imediatamente anterior
  const { data: messages } = await admin
    .from("messages")
    .select("id, role, content, created_at")
    .eq("session_id", body.session_id)
    .order("created_at", { ascending: true })

  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: "Nenhuma mensagem encontrada." }, { status: 404 })
  }

  const aiMsgIdx = messages.findIndex((m) => m.id === body.assistant_message_id)
  if (aiMsgIdx === -1) {
    return NextResponse.json({ error: "Mensagem do assistente não encontrada." }, { status: 404 })
  }

  // Busca a mensagem de usuário imediatamente anterior
  const userMsg = messages.slice(0, aiMsgIdx).reverse().find((m) => m.role === "user")
  if (!userMsg) {
    return NextResponse.json({ error: "Não foi possível encontrar a mensagem do usuário original." }, { status: 404 })
  }

  // Histórico de contexto: todas as mensagens ANTES da resposta a regenerar
  const history = messages
    .slice(0, aiMsgIdx)
    .filter((m): m is typeof m & { role: "user" | "assistant" } =>
      m.role === "user" || m.role === "assistant"
    )
    .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content ?? "") }))

  void logActivity({
    userId:    user.id,
    eventType: "chat",
    action:    "chat_message_regenerated",
    detail:    `Regenerando resposta da sessão ${body.session_id}`,
    companyId: session.company_id as string,
    metadata:  {
      session_id:           body.session_id,
      assistant_message_id: body.assistant_message_id,
      user_message_id:      userMsg.id,
    },
  })

  // Retorna o contexto para o cliente re-enviar
  return NextResponse.json({
    user_message:        userMsg.content,
    history,
    session_id:          body.session_id,
    agent_id:            session.agent_id ?? null,
    company_id:          session.company_id,
    regenerated_from_id: body.assistant_message_id,
  })
}
