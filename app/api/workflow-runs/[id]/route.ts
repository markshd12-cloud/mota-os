import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { getAllowedCompanyIds, isGlobalAdmin } from "@/lib/company-scope"

export const dynamic = "force-dynamic"

// ─── GET — detalhes de uma execução ──────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  const { data, error } = await admin
    .from("workflow_runs")
    .select("*")
    .eq("id", id)
    .single()

  if (error || !data) return NextResponse.json({ error: "Execução não encontrada" }, { status: 404 })

  // Verificar acesso
  const runCompany = data.company_id as string | null
  if (runCompany) {
    const allowed = await getAllowedCompanyIds(user.id)
    if (!(allowed as string[]).includes(runCompany)) {
      return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
    }
  } else if (data.user_id !== user.id) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  return NextResponse.json({ run: data })
}

// ─── DELETE — remover execução (admin ou dono) ────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  const { data, error } = await admin
    .from("workflow_runs")
    .select("company_id, user_id")
    .eq("id", id)
    .single()

  if (error || !data) return NextResponse.json({ error: "Execução não encontrada" }, { status: 404 })

  const runUserId  = data.user_id  as string | null
  const runCompany = data.company_id as string | null

  const adminFlag = await isGlobalAdmin(user.id)
  if (!adminFlag && runUserId !== user.id) {
    // Verificar se tem acesso à empresa
    if (runCompany) {
      const allowed = await getAllowedCompanyIds(user.id)
      if (!(allowed as string[]).includes(runCompany)) {
        return NextResponse.json({ error: "Sem permissão para excluir esta execução" }, { status: 403 })
      }
    } else {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 })
    }
  }

  await admin.from("workflow_runs").delete().eq("id", id)

  return NextResponse.json({ ok: true })
}
