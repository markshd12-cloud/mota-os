import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin }                        from "@/lib/company-scope"
import { logActivity }                          from "@/lib/activity-logger"
import { sanitizeReportText, companyLabel }     from "@/lib/daily-report-utils"

export const dynamic = "force-dynamic"

// ─── Monta mensagem final para o Rocket.Chat ──────────────────────────────────
// Cabeçalho gerado pelo sistema; IA fornece apenas o corpo em report_text.
// Atividades NÃO aparecem no envio — são insumo da IA, não conteúdo final.

function buildMessage(report: {
  name:        string
  company_id:  string
  report_date: string
  role:        string | null
  sector:      string | null
  report_text: string
}): string {
  const dateStr = new Date(report.report_date + "T12:00:00").toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  })

  // Sanitiza o texto antes de enviar — garante que não há cabeçalho duplicado
  // mesmo em relatórios gerados antes da correção do prompt.
  const cleanText = sanitizeReportText(report.report_text)

  return [
    `📋 *Relatório Diário — ${report.name}*`,
    `🏢 Empresa: ${companyLabel(report.company_id)}`,
    `📅 Data: ${dateStr}`,
    report.role   ? `👤 Cargo/Função: ${report.role}`   : null,
    report.sector ? `🏷️ Setor: ${report.sector}` : null,
    "",
    "*Relatório do dia:*",
    cleanText,
    "",
    "_Gerado pelo Jarvis_",
  ].filter((l) => l !== null).join("\n")
}

// ─── POST — enviar relatório ao Rocket.Chat ───────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  // Buscar relatório
  const { data: report, error: fetchErr } = await admin
    .from("daily_reports")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (fetchErr || !report) return NextResponse.json({ error: "Relatório não encontrado" }, { status: 404 })

  const isAdmin = await isGlobalAdmin(user.id)
  if (!isAdmin && (report.user_id as string) !== user.id) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  if (!report.report_text) {
    return NextResponse.json(
      { error: "Gere o relatório antes de enviar." },
      { status: 400 },
    )
  }

  // Buscar destino Rocket.Chat tipo daily_report
  const { data: dest } = await admin
    .from("rocketchat_destinations")
    .select("id,mode,webhook_url,base_url,user_id,auth_token,channel,alias,avatar")
    .eq("type", "daily_report")
    .eq("is_default", true)
    .is("deleted_at", null)
    .neq("status", "inactive")
    .or(`company_id.is.null,company_id.eq.${report.company_id as string}`)
    .order("company_id", { ascending: false }) // empresa-específico primeiro
    .limit(1)
    .maybeSingle()

  if (!dest) {
    return NextResponse.json(
      { error: "Destino Rocket.Chat para Relatório Diário não configurado. Acesse Configurações > APIs > Destinos Rocket.Chat." },
      { status: 422 },
    )
  }

  const message = buildMessage({
    name:        report.name        as string,
    company_id:  report.company_id  as string,
    report_date: report.report_date as string,
    role:        (report.role       as string | null),
    sector:      (report.sector     as string | null),
    report_text: report.report_text as string,
  })

  let success      = false
  let errorMessage = ""
  let logChannel   = dest.channel as string

  try {
    if ((dest.mode as string) === "webhook") {
      const webhookUrl = dest.webhook_url as string
      if (!webhookUrl) throw new Error("webhook_url não configurado")

      const body: Record<string, string> = {
        alias:   (dest.alias as string | null) ?? "Jarvis",
        channel: dest.channel as string,
        text:    message,
      }
      if (dest.avatar) body.avatar = dest.avatar as string

      const res = await fetch(webhookUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      if (!res.ok) {
        let errBody = ""
        try { errBody = await res.text() } catch { /* noop */ }
        throw new Error(`HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ""}`)
      }
    } else {
      // REST mode
      const baseUrl   = dest.base_url   as string | null
      const userId    = dest.user_id    as string | null
      const authToken = dest.auth_token as string | null
      if (!baseUrl || !userId || !authToken) throw new Error("Configuração REST incompleta")

      const channel = (dest.channel as string).startsWith("#") || (dest.channel as string).startsWith("@")
        ? dest.channel as string
        : `#${dest.channel as string}`
      logChannel = channel

      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/chat.postMessage`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": authToken,
          "X-User-Id":    userId,
        },
        body: JSON.stringify({ channel, text: message }),
      })
      const rcJson = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || rcJson.success === false) {
        throw new Error(rcJson.error ?? `HTTP ${res.status}`)
      }
    }
    success = true
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Erro desconhecido"
  }

  const now = new Date().toISOString()

  // Atualizar relatório com resultado do envio
  await admin
    .from("daily_reports")
    .update({
      rocketchat_status:  success ? "success" : "error",
      rocketchat_channel: logChannel,
      rocketchat_sent_at: success ? now : null,
      status:             success ? "sent" : "error",
      submitted_at:       success ? now : null,
      updated_at:         now,
    })
    .eq("id", id)

  // Log de integração — nunca salvar webhook_url nem auth_token
  try {
    await admin.from("integration_logs").insert({
      provider:      "rocketchat",
      action:        "send_message",
      status:        success ? "success" : "error",
      user_id:       user.id,
      session_id:    null,
      payload: {
        destination_id:   dest.id,
        destination_type: "daily_report",
        channel:          logChannel,
        message_length:   message.length,
        source_type:      "daily_report",
        source_id:        id,
      },
      response:      {},
      error_message: errorMessage || null,
    })
  } catch { /* silencioso */ }

  void logActivity({
    userId:    user.id,
    eventType: "auto",
    action:    success ? "daily_report_sent_rocketchat" : "daily_report_send_failed",
    detail:    `${report.name as string} — ${report.report_date as string}`,
    metadata:  {
      report_id:   id,
      channel:     logChannel,
      success,
      error:       errorMessage || null,
      company_id:  report.company_id,
    },
    companyId: (report.company_id as string) ?? undefined,
  })

  if (!success) {
    return NextResponse.json(
      { error: errorMessage || "Falha ao enviar para o Rocket.Chat" },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, channel: logChannel })
}
