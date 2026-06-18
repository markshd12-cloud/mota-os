import { NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds, ALL_SLUGS } from "@/lib/company-scope"

export const dynamic = "force-dynamic"

// Contadores informativos para a sidebar (projetos e agentes ativos no escopo do
// usuário). Nunca lança — em qualquer falha retorna zeros para não quebrar a UI.
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ projects: 0, agents: 0 })

    const [isAdmin, allowed] = await Promise.all([
      isGlobalAdmin(user.id),
      getAllowedCompanyIds(user.id),
    ])
    const scope = isAdmin ? ALL_SLUGS : allowed
    const admin = createAdminClient()

    if (scope.length === 0) return NextResponse.json({ projects: 0, agents: 0 })

    // Projetos ativos no escopo
    const projectsP = admin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .in("company_id", scope)
      .eq("status", "active")
      .is("deleted_at", null)

    // Agentes ativos visíveis ao usuário
    const agentsP = (async () => {
      if (isAdmin) {
        const { count } = await admin
          .from("agents")
          .select("id", { count: "exact", head: true })
          .eq("kind", "agent")
          .eq("status", "active")
          .is("deleted_at", null)
        return count ?? 0
      }
      // Não-admin: agentes vinculados às empresas permitidas
      const { data: links } = await admin
        .from("agent_companies")
        .select("agent_id")
        .in("company_id", scope)
      const ids = [...new Set((links ?? []).map(l => l.agent_id as string))]
      if (ids.length === 0) return 0
      const { count } = await admin
        .from("agents")
        .select("id", { count: "exact", head: true })
        .in("id", ids)
        .eq("kind", "agent")
        .eq("status", "active")
        .is("deleted_at", null)
      return count ?? 0
    })()

    const [{ count: projectsCount }, agentsCount] = await Promise.all([projectsP, agentsP])

    return NextResponse.json({
      projects: projectsCount ?? 0,
      agents:   agentsCount,
    })
  } catch {
    return NextResponse.json({ projects: 0, agents: 0 })
  }
}
