import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin } from "@/lib/company-scope"
import { logActivity }   from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

async function fetchReport(admin: ReturnType<typeof createAdminClient>, id: string) {
  const { data, error } = await admin
    .from("daily_reports")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single()
  return { data, error }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await fetchReport(admin, id)

  if (error || !data) return NextResponse.json({ error: "Relatório não encontrado" }, { status: 404 })

  const isAdmin = await isGlobalAdmin(user.id)
  if (!isAdmin && (data.user_id as string) !== user.id) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  return NextResponse.json({ report: data })
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: existing } = await fetchReport(admin, id)
  if (!existing) return NextResponse.json({ error: "Relatório não encontrado" }, { status: 404 })

  const isAdmin = await isGlobalAdmin(user.id)
  if (!isAdmin && (existing.user_id as string) !== user.id) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const body = await req.json() as {
    name?:         string
    sector?:       string
    role?:         string
    activities?:   string[]
    report_text?:  string
    status?:       string
    ai_used?:      boolean
    generated_at?: string
    submitted_at?: string
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name         !== undefined) patch.name         = body.name
  if (body.sector       !== undefined) patch.sector       = body.sector
  if (body.role         !== undefined) patch.role         = body.role
  if (body.activities   !== undefined) patch.activities   = body.activities
  if (body.report_text  !== undefined) patch.report_text  = body.report_text
  if (body.status       !== undefined) patch.status       = body.status
  if (body.ai_used      !== undefined) patch.ai_used      = body.ai_used
  if (body.generated_at !== undefined) patch.generated_at = body.generated_at
  if (body.submitted_at !== undefined) patch.submitted_at = body.submitted_at

  const { data, error } = await admin
    .from("daily_reports")
    .update(patch)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json({ report: data })
}

// ─── DELETE — soft delete ─────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: existing } = await fetchReport(admin, id)
  if (!existing) return NextResponse.json({ error: "Relatório não encontrado" }, { status: 404 })

  const isAdmin = await isGlobalAdmin(user.id)
  if (!isAdmin && (existing.user_id as string) !== user.id) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  await admin
    .from("daily_reports")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)

  void logActivity({
    userId:    user.id,
    eventType: "auto",
    action:    "daily_report_deleted",
    detail:    `Relatório ${existing.report_date as string}`,
    metadata:  { report_id: id },
    companyId: (existing.company_id as string) ?? undefined,
  })

  return NextResponse.json({ ok: true })
}
