import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin } from "@/lib/company-scope"
import { indexSource } from "@/lib/rag/index-source"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const adminFlag = await isGlobalAdmin(user.id)
  if (!adminFlag) return NextResponse.json({ error: "Apenas admins podem executar backfill" }, { status: 403 })

  const body = await req.json().catch(() => ({})) as {
    company_id?: string
    force?:      boolean
  }

  const admin  = createAdminClient()
  const force  = body.force ?? false
  const report = { indexed: 0, skipped: 0, errors: 0, details: [] as string[] }

  // ── knowledge_sources ─────────────────────────────────────────────────────
  {
    let query = admin
      .from("knowledge_sources")
      .select("id, company_id, name, content, embedding_status, content_hash")
      .not("content", "is", null)
      .neq("content", "")

    if (!force) query = query.neq("embedding_status", "done")
    if (body.company_id) query = query.eq("company_id", body.company_id)

    const { data: sources } = await query

    for (const src of sources ?? []) {
      try {
        const result = await indexSource({
          sourceId:     src.id as string,
          sourceType:   "knowledge_source",
          content:      src.content as string,
          title:        src.name as string,
          companyId:    src.company_id as string,
          createdBy:    user.id,
          forceReindex: force,
        })
        if (result.skipped) report.skipped++
        else                report.indexed++
      } catch (err) {
        report.errors++
        report.details.push(`knowledge_source ${src.id}: ${err instanceof Error ? err.message : "erro"}`)
      }
    }
  }

  // ── agent_files ───────────────────────────────────────────────────────────
  {
    let query = admin
      .from("agent_files")
      .select("id, agent_id, company_id, file_name, extracted_text, embedding_status, content_hash")
      .not("extracted_text", "is", null)
      .neq("extracted_text", "")

    if (!force) query = query.neq("embedding_status", "done")

    const { data: files } = await query

    for (const af of files ?? []) {
      try {
        const result = await indexSource({
          sourceId:     af.id as string,
          sourceType:   "agent_file",
          content:      af.extracted_text as string,
          title:        af.file_name as string,
          companyId:    af.company_id as string | undefined,
          agentId:      af.agent_id  as string,
          createdBy:    user.id,
          forceReindex: force,
        })
        if (result.skipped) report.skipped++
        else                report.indexed++
      } catch (err) {
        report.errors++
        report.details.push(`agent_file ${af.id}: ${err instanceof Error ? err.message : "erro"}`)
      }
    }
  }

  return NextResponse.json({ ok: true, ...report })
}
