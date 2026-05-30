import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds, getCurrentCompany } from "@/lib/company-scope"
import { logActivity } from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

// ─── GET — buscar relatório do dia ou listar (admin) ──────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const dateParam    = searchParams.get("date")     // YYYY-MM-DD
  const companyParam = searchParams.get("company_id")
  const listMode     = searchParams.get("list") === "true"

  const admin    = createAdminClient()
  const isAdmin  = await isGlobalAdmin(user.id)
  const company  = companyParam ?? await getCurrentCompany(user.id)

  // Acesso por empresa
  if (companyParam && !isAdmin) {
    const allowed = await getAllowedCompanyIds(user.id)
    if (!(allowed as string[]).includes(companyParam)) {
      return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
    }
  }

  // Modo lista: admin/manager lista relatórios da empresa
  if (listMode && isAdmin) {
    const query = admin
      .from("daily_reports")
      .select("id,user_id,company_id,report_date,name,sector,role,status,rocketchat_status,generated_at,submitted_at,created_at,updated_at")
      .eq("company_id", company)
      .is("deleted_at", null)
      .order("report_date", { ascending: false })
      .limit(100)

    if (dateParam) {
      const { data, error } = await query.eq("report_date", dateParam)
      if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
      return NextResponse.json({ reports: data ?? [] })
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
    return NextResponse.json({ reports: data ?? [] })
  }

  // Buscar relatório do próprio usuário para uma data específica
  const today = dateParam ?? new Date().toISOString().split("T")[0]

  const { data, error } = await admin
    .from("daily_reports")
    .select("*")
    .eq("user_id", user.id)
    .eq("company_id", company)
    .eq("report_date", today)
    .is("deleted_at", null)
    .maybeSingle()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json({ report: data ?? null, date: today, company_id: company })
}

// ─── POST — criar ou atualizar rascunho (upsert) ──────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    company_id?:   string
    report_date?:  string
    name?:         string
    sector?:       string
    role?:         string
    activities?:   string[]
    report_text?:  string
    status?:       string
  }

  const admin      = createAdminClient()
  const company    = body.company_id ?? await getCurrentCompany(user.id)
  const reportDate = body.report_date ?? new Date().toISOString().split("T")[0]

  // Validar acesso à empresa
  if (body.company_id) {
    const allowed = await getAllowedCompanyIds(user.id)
    if (!(allowed as string[]).includes(body.company_id)) {
      return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
    }
  }

  // Buscar nome/cargo/setor do profile se não enviados
  let name   = body.name
  let sector = body.sector
  let role   = body.role

  if (!name || !sector || !role) {
    const { data: profile } = await admin
      .from("profiles")
      .select("name, email, job_title, department")
      .eq("id", user.id)
      .single()

    name   ??= profile?.name || profile?.email || user.email || "Colaborador"
    sector ??= profile?.department ?? ""
    role   ??= profile?.job_title  ?? ""
  }

  const { data, error } = await admin
    .from("daily_reports")
    .upsert(
      {
        user_id:     user.id,
        company_id:  company,
        report_date: reportDate,
        name,
        sector:      sector ?? null,
        role:        role   ?? null,
        activities:  body.activities  ?? [],
        report_text: body.report_text ?? null,
        status:      body.status      ?? "draft",
        updated_at:  new Date().toISOString(),
      },
      { onConflict: "user_id,company_id,report_date" },
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "auto",
    action:    "daily_report_draft_saved",
    detail:    `${name} — ${reportDate}`,
    metadata:  { report_id: data.id, company_id: company, date: reportDate },
    companyId: company,
  })

  return NextResponse.json({ report: data })
}
