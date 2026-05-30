import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { getCurrentCompany, getAllowedCompanyIds } from "@/lib/company-scope"

export const dynamic = "force-dynamic"

// ─── GET — histórico de execuções ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const workflowId  = searchParams.get("workflow_id")
  const companyParam = searchParams.get("company_id")
  const statusParam  = searchParams.get("status")
  const limit        = Math.min(Number(searchParams.get("limit") ?? "50"), 100)

  const admin   = createAdminClient()
  const company = companyParam ?? await getCurrentCompany(user.id)

  // Validar acesso à empresa
  if (companyParam) {
    const allowed = await getAllowedCompanyIds(user.id)
    if (!(allowed as string[]).includes(companyParam)) {
      return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
    }
  }

  let query = admin
    .from("workflow_runs")
    .select("id, workflow_id, workflow_name, company_id, user_id, status, result, error_message, provider, model_used, input_tokens, output_tokens, started_at, completed_at, created_at, duration_ms")
    .eq("company_id", company)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (workflowId) query = query.eq("workflow_id", workflowId)
  if (statusParam) query = query.eq("status", statusParam)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json({ runs: data ?? [], company_id: company })
}
