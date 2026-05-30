import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

const EVENT_TYPES = ["chat", "workflow", "auto", "source", "watcher", "auth", "settings", "api"] as const

// ─── GET — lista logs do usuário (ou todos, se admin) ─────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  // Verificar role do usuário
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  const isAdmin = profile?.role === "admin"

  const url        = new URL(req.url)
  const eventType  = url.searchParams.get("event_type") ?? ""
  const companyId  = url.searchParams.get("company_id") ?? ""
  const limitParam = parseInt(url.searchParams.get("limit") ?? "50")
  const offsetParam = parseInt(url.searchParams.get("offset") ?? "0")
  const limit  = Math.min(isNaN(limitParam)  ? 50  : limitParam,  200)
  const offset = isNaN(offsetParam) ? 0 : offsetParam

  let query = admin
    .from("activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  // Usuário comum vê apenas seus próprios logs
  if (!isAdmin) {
    query = query.eq("user_id", user.id)
  }

  if (eventType && (EVENT_TYPES as readonly string[]).includes(eventType)) {
    query = query.eq("event_type", eventType)
  }

  if (companyId) {
    query = query.eq("company_id", companyId)
  }

  const { data: logs, error } = await query

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  const rows = logs ?? []

  // Admin: enriquecer com e-mail/nome do usuário
  if (isAdmin && rows.length > 0) {
    const userIds = [...new Set(rows.map((l) => l.user_id).filter(Boolean))] as string[]
    if (userIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, email, name")
        .in("id", userIds)
      const pMap = new Map((profiles ?? []).map((p) => [p.id, p]))
      const enriched = rows.map((log) => ({
        ...log,
        user_email: pMap.get(log.user_id ?? "")?.email ?? null,
        user_name:  pMap.get(log.user_id ?? "")?.name  ?? null,
      }))
      return NextResponse.json({ logs: enriched, is_admin: true })
    }
  }

  return NextResponse.json({ logs: rows, is_admin: isAdmin })
}
