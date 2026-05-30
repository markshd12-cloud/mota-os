import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope"
import { mapProjectFile } from "@/lib/project-helpers"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data: project } = await admin
    .from("projects").select("company_id").eq("id", id).is("deleted_at", null).single()
  if (!project) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 })

  const [isAdmin, allowed] = await Promise.all([isGlobalAdmin(user.id), getAllowedCompanyIds(user.id)])
  if (!isAdmin && !allowed.includes(project.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  const { data, error } = await admin
    .from("project_files")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json((data ?? []).map(mapProjectFile))
}
