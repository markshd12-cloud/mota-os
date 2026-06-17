import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase-admin"
import { syncNotionCompany } from "@/lib/notion-sync"

export const dynamic = "force-dynamic"
// Tempo máximo de execução (Vercel) — sync de várias empresas pode demorar
export const maxDuration = 300

// Cron agendado (ver vercel.json). Percorre todas as empresas com Notion
// conectado e re-indexa as fontes. Protegido por CRON_SECRET.
//
// Para alterar a frequência: edite o campo "schedule" em vercel.json
// (formato cron). Padrão: "0 */6 * * *" = a cada 6 horas.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  // A Vercel envia automaticamente "Authorization: Bearer <CRON_SECRET>"
  if (!secret) {
    // Em produção, falha fechado: sem segredo configurado o cron fica inacessível
    // (evita disparo público não autenticado). Em dev, permite para facilitar testes.
    const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"
    return !isProd
  }
  const header = req.headers.get("authorization")
  if (header === `Bearer ${secret}`) return true
  // Fallback: permite ?secret= para disparo manual/testes
  const url = new URL(req.url)
  return url.searchParams.get("secret") === secret
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: integrations, error } = await admin
    .from("notion_integrations")
    .select("company_id")

  if (error) {
    return NextResponse.json({ error: "Erro ao listar integrações" }, { status: 500 })
  }
  if (!integrations || integrations.length === 0) {
    return NextResponse.json({ ok: true, companies: 0, message: "Nenhuma integração Notion." })
  }

  const report: Record<string, unknown> = {}
  let totalUpdated = 0

  for (const { company_id } of integrations as { company_id: string }[]) {
    try {
      const result = await syncNotionCompany(company_id) // sem actorId → "system"
      report[company_id] = result ?? { skipped: "not_connected" }
      if (result) totalUpdated += result.updated
    } catch (err) {
      report[company_id] = { error: err instanceof Error ? err.message : "erro" }
    }
  }

  return NextResponse.json({
    ok: true,
    companies: integrations.length,
    total_updated: totalUpdated,
    report,
    ran_at: new Date().toISOString(),
  })
}
