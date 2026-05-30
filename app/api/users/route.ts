import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const isAdmin = await isGlobalAdmin(user.id)
  const { searchParams } = new URL(req.url)
  const companyFilter = searchParams.get("company_id")
  const search        = searchParams.get("search")?.trim()

  const admin = createAdminClient()

  if (!isAdmin) {
    if (!companyFilter) {
      return NextResponse.json({ error: "Sem permissão para listar todos os usuários" }, { status: 403 })
    }
    const allowed = await getAllowedCompanyIds(user.id)
    if (!(allowed as string[]).includes(companyFilter)) {
      return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
    }
  }

  let profileQuery = admin
    .from("profiles")
    .select("id, name, email, role, job_title, department, default_company_id, avatar_url, created_at, updated_at")
    .order("name", { ascending: true })

  if (search) {
    profileQuery = profileQuery.or(`name.ilike.%${search}%,email.ilike.%${search}%`)
  }

  const { data: profiles, error: profErr } = await profileQuery
  if (profErr) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  const { data: members } = await admin
    .from("company_members")
    .select("user_id, company_id, role, status")
    .eq("status", "active")

  const memberMap: Record<string, Array<{ company_id: string; role: string }>> = {}
  for (const m of members ?? []) {
    const uid = m.user_id as string
    if (!memberMap[uid]) memberMap[uid] = []
    memberMap[uid].push({ company_id: m.company_id as string, role: (m.role as string) ?? "member" })
  }

  let users = (profiles ?? []).map((p) => ({
    ...p,
    companies: (memberMap[p.id as string] ?? []).map((m) => m.company_id),
    company_roles: Object.fromEntries(
      (memberMap[p.id as string] ?? []).map((m) => [m.company_id, m.role]),
    ),
  }))

  if (companyFilter) {
    users = users.filter((u) => u.companies.includes(companyFilter))
  }

  return NextResponse.json({ users })
}
