import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope"
import { syncNotionCompany } from "@/lib/notion-sync"

export const dynamic = "force-dynamic"

// Sincronização manual (botão em Settings). A lógica vive em lib/notion-sync.

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body      = await req.json().catch(() => ({})) as { company_id?: string }
  const companyId = body.company_id
  if (!companyId) return NextResponse.json({ error: "company_id obrigatório" }, { status: 400 })

  const [isAdmin, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!isAdmin && !(allowed as string[]).includes(companyId)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  try {
    const result = await syncNotionCompany(companyId, user.id)
    if (result === null) {
      return NextResponse.json({ error: "Notion não conectado", not_connected: true }, { status: 404 })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[notion/sync]", err)
    return NextResponse.json({ error: "Erro ao sincronizar" }, { status: 500 })
  }
}
