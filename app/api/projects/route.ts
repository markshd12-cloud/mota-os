import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds, ALL_SLUGS } from "@/lib/company-scope"
import { logActivity }       from "@/lib/activity-logger"
import { mapProject }        from "@/lib/project-helpers"

export const dynamic = "force-dynamic"

// ─── GET — listar projetos da empresa ────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const companyId    = searchParams.get("company_id")
  const statusFilter = searchParams.get("status")

  if (!companyId || !(ALL_SLUGS as string[]).includes(companyId)) {
    return NextResponse.json({ error: "company_id obrigatório e válido" }, { status: 400 })
  }

  const [isAdmin, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!isAdmin && !allowed.includes(companyId as typeof ALL_SLUGS[number])) {
    return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
  }

  const admin = createAdminClient()

  // deleted_at foi adicionado pela migration E.1; se o schema cache ainda não recarregou,
  // o filtro .is("deleted_at", null) causa erro 42703. Tentamos com o filtro e, em caso
  // de falha de schema cache, fazemos fallback sem ele.
  const buildQuery = (withDeletedFilter: boolean) => {
    let q = admin
      .from("projects")
      .select("*")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
    if (withDeletedFilter) q = q.is("deleted_at", null)
    if (statusFilter && statusFilter !== "all") {
      q = q.eq("status", statusFilter)
    } else {
      q = q.neq("status", "archived")
    }
    return q
  }

  let { data, error } = await buildQuery(true)

  if (error && (error.message.includes("deleted_at") || error.message.includes("schema cache"))) {
    ;({ data, error } = await buildQuery(false))
  }

  // Remove manualmente rows com deleted_at preenchido se o filtro do fallback foi usado
  if (!error && data) {
    data = data.filter((r: Record<string, unknown>) => !r.deleted_at)
  }

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json((data ?? []).map(mapProject))
}

// ─── POST — criar projeto ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    company_id?:  string
    name?:        string
    description?: string
    status?:      string
    priority?:    string
    owner_id?:    string | null
    start_date?:  string
    due_date?:    string
    budget?:      number | null
    objectives?:  string
    tags?:        string[]
  }

  if (!body.company_id || !(ALL_SLUGS as string[]).includes(body.company_id)) {
    return NextResponse.json({ error: "company_id inválido" }, { status: 400 })
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name obrigatório" }, { status: 400 })
  }

  const [isAdmin, allowed] = await Promise.all([
    isGlobalAdmin(user.id),
    getAllowedCompanyIds(user.id),
  ])
  if (!isAdmin && !allowed.includes(body.company_id as typeof ALL_SLUGS[number])) {
    return NextResponse.json({ error: "Sem acesso a esta empresa" }, { status: 403 })
  }

  const admin    = createAdminClient()
  const nameVal  = body.name!.trim()
  const ownerVal = body.owner_id ?? null
  const dueVal   = body.due_date ?? null
  const startVal = body.start_date ?? new Date().toISOString().split("T")[0]

  // Payload com colunas originais (sempre existem) + novas (adicionadas pelo hotfix E.1)
  const insertFull = {
    title:          nameVal,
    description:    body.description ?? "",
    company_id:     body.company_id,
    status:         body.status ?? "planning",
    responsible_id: ownerVal,
    start_date:     startVal,
    end_date:       dueVal,
    budget:         body.budget ?? null,
    tags:           body.tags ?? [],
    highlights:     [],
    progress:       0,
    sessions_count: 0,
    tasks_open:     0,
    tasks_total:    0,
    // Colunas novas — podem não estar no schema cache ainda
    name:           nameVal,
    owner_id:       ownerVal,
    due_date:       dueVal,
    priority:       body.priority ?? "medium",
    objectives:     body.objectives ?? null,
  }

  // Payload mínimo com apenas colunas originais (fallback se cache ainda estiver desatualizado)
  const insertBase = {
    title:          nameVal,
    description:    body.description ?? "",
    company_id:     body.company_id,
    status:         body.status ?? "planning",
    responsible_id: ownerVal,
    start_date:     startVal,
    end_date:       dueVal,
    budget:         body.budget ?? null,
    tags:           body.tags ?? [],
    highlights:     [],
    progress:       0,
    sessions_count: 0,
    tasks_open:     0,
    tasks_total:    0,
  }

  let { data, error } = await admin.from("projects").insert(insertFull).select().single()

  // Se falhou por coluna desconhecida no schema cache, tenta só com as colunas originais
  if (error && (error.message.includes("schema cache") || error.message.includes("column"))) {
    ;({ data, error } = await admin.from("projects").insert(insertBase).select().single())
  }

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Projeto criado",
    detail:    `${body.name.trim()} → ${body.company_id}`,
    companyId: body.company_id,
  })

  return NextResponse.json(mapProject(data), { status: 201 })
}

// ─── DELETE — arquivar projeto (id no body) ────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as { id?: string }
  if (!body.id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 })

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("projects").select("company_id, title").eq("id", body.id).single()
  if (!existing) return NextResponse.json({ error: "Projeto não encontrado" }, { status: 404 })

  const [isAdmin, allowed] = await Promise.all([isGlobalAdmin(user.id), getAllowedCompanyIds(user.id)])
  if (!isAdmin && !allowed.includes(existing.company_id)) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
  }

  // archived_at foi adicionado pela migration E.1; status="archived" é suficiente caso o campo ainda não esteja no schema cache
  let { error } = await admin
    .from("projects")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", body.id)

  if (error?.message?.includes("schema cache") || error?.message?.includes("archived_at")) {
    const fallback = await admin.from("projects").update({ status: "archived" }).eq("id", body.id)
    error = fallback.error
  }
  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId: user.id, eventType: "settings",
    action: "Projeto arquivado", detail: existing.title, companyId: existing.company_id,
  })

  return NextResponse.json({ ok: true })
}
