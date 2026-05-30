import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { streamChat }          from "@/lib/ai-service"
import { isGlobalAdmin }       from "@/lib/company-scope"
import { logActivity }         from "@/lib/activity-logger"
import { sanitizeReportText }  from "@/lib/daily-report-utils"

export const dynamic = "force-dynamic"

// ─── Fallback local (quando IA falhar) ────────────────────────────────────────

function generateLocalFallback(
  sector:     string,
  role:       string,
  activities: string[],
): string {
  const activitiesText = activities.length > 0
    ? activities.map((a) => `• ${a}`).join("\n")
    : "• Atividades do dia registradas."

  const sectorLine = sector ? ` no setor de ${sector}` : ""
  const roleLine   = role   ? ` como ${role}` : ""

  return `Durante o dia de hoje${roleLine}${sectorLine}, as seguintes atividades foram realizadas:

${activitiesText}

Todas as atividades foram executadas com foco nos objetivos estratégicos da organização, contribuindo para o progresso contínuo das metas institucionais.`
}

// ─── POST — gerar relatório com IA ────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
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

  const activities = (report.activities as string[]) ?? []
  if (activities.length === 0) {
    return NextResponse.json(
      { error: "Adicione ao menos uma atividade antes de gerar o relatório." },
      { status: 400 },
    )
  }

  const sector     = (report.sector as string | null) ?? ""
  const role       = (report.role   as string | null) ?? ""
  const reportDate = report.report_date as string
  const companyId  = report.company_id  as string

  const activitiesList = activities.map((a) => `• ${a}`).join("\n")

  // ─── Prompt: a IA deve gerar APENAS o corpo do relatório ──────────────────
  const systemPrompt = `Você é um assistente de RH do Jarvis. Sua tarefa é transformar uma lista de atividades diárias em um texto profissional descrevendo o trabalho realizado.

Regras obrigatórias:
- Gere APENAS o corpo do relatório — texto corrido ou tópicos organizados
- NÃO inclua: título, cabeçalho, nome do colaborador, cargo, setor, empresa, data, saudação, despedida ou assinatura
- NÃO comece com "Relatório", "#", "Colaborador:", "Data:" ou qualquer cabeçalho
- NÃO termine com "Gerado pelo", "Atenciosamente" ou qualquer assinatura
- Escreva diretamente o conteúdo, como se fosse o corpo de um e-mail profissional já com cabeçalho separado
- Tom profissional e acessível, máximo 250 palavras
- Transforme as atividades em uma descrição fluente, sem listar em tópicos quando possível
- Em português do Brasil`

  const userPrompt = `Transforme as atividades abaixo em um parágrafo profissional descrevendo o trabalho realizado hoje:

${activitiesList}

${role   ? `Contexto de cargo (não inclua no texto): ${role}` : ""}
${sector ? `Contexto de setor (não inclua no texto): ${sector}` : ""}

Gere apenas o corpo do texto, sem título, sem cabeçalho e sem assinatura.`

  let reportText = ""
  let aiUsed     = false

  try {
    for await (const chunk of streamChat({
      messages: [{ role: "user", content: userPrompt }],
      system:   systemPrompt,
    })) {
      if (!chunk.done) {
        reportText += chunk.text
      } else if ("error" in chunk) {
        throw new Error(chunk.error)
      }
    }
    // Sanitiza antes de salvar — remove qualquer cabeçalho gerado indevidamente
    reportText = sanitizeReportText(reportText)
    aiUsed     = true
  } catch {
    reportText = generateLocalFallback(sector, role, activities)
    aiUsed     = false
  }

  const now = new Date().toISOString()
  const { data: updated, error: updateErr } = await admin
    .from("daily_reports")
    .update({
      report_text:  reportText,
      ai_used:      aiUsed,
      generated_at: now,
      status:       "generated",
      updated_at:   now,
    })
    .eq("id", id)
    .select()
    .single()

  if (updateErr) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "auto",
    action:    "daily_report_generated",
    detail:    `${report.name as string} — ${reportDate}`,
    metadata:  { report_id: id, ai_used: aiUsed, company_id: companyId },
    companyId,
  })

  return NextResponse.json({ report: updated, ai_used: aiUsed })
}
