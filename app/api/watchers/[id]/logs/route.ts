import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { getAllowedCompanyIds, isGlobalAdmin } from "@/lib/company-scope"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  const { data: watcher } = await admin
    .from("watchers")
    .select("id, company_id")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (!watcher) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })

  const isAdmin = await isGlobalAdmin(user.id)
  if (!isAdmin) {
    const allowed = await getAllowedCompanyIds(user.id)
    if (!allowed.includes(watcher.company_id)) {
      return NextResponse.json({ error: "Sem acesso a este vigia" }, { status: 403 })
    }
  }

  const { data, error } = await admin
    .from("watcher_logs")
    .select("id, status, triggered, message, result, result_data, matched_count, error_message, started_at, finished_at")
    .eq("watcher_id", id)
    .order("started_at", { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  return NextResponse.json(data)
}
