import { NextResponse }      from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin }     from "@/lib/company-scope"
import type { SlashAgentPublic } from "@/lib/slash-agents"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin   = createAdminClient()
  const isAdmin = await isGlobalAdmin(user.id)

  try {
    // ── IMPORTANTE: reassignar query ao aplicar cada filtro ──────────────────
    let query = admin
      .from("slash_agents")
      .select("id, command, label, description, icon, admin_only, sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: true })

    if (!isAdmin) {
      query = query.eq("admin_only", false)
    }

    const { data, error } = await query

    if (error) {
      // Tabela pode não existir ainda (migration pendente) — retornar array vazio sem quebrar
      console.error("[slash-agents] query error:", error.message)
      return NextResponse.json([] as SlashAgentPublic[])
    }

    return NextResponse.json((data ?? []) as SlashAgentPublic[])

  } catch (e) {
    console.error("[slash-agents] unexpected error:", e instanceof Error ? e.message : e)
    return NextResponse.json([] as SlashAgentPublic[])
  }
}
