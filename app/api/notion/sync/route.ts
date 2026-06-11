import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope"
import { getNotionClientForCompany, fetchPageContent } from "@/lib/notion"
import { indexSource } from "@/lib/rag/index-source"
import { logActivity } from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

// Re-sincroniza e re-indexa todas as fontes do tipo "notion" de uma empresa:
// busca o conteúdo atualizado no Notion e re-gera os embeddings. O indexSource
// usa content_hash, então só re-processa o que mudou.

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

  const notion = await getNotionClientForCompany(companyId)
  if (!notion) return NextResponse.json({ error: "Notion não conectado", not_connected: true }, { status: 404 })

  const admin = createAdminClient()

  // Fontes Notion ativas da empresa
  const { data: sources, error } = await admin
    .from("knowledge_sources")
    .select("id, name, description, metadata")
    .eq("company_id", companyId)
    .eq("type", "notion")
    .eq("status", "active")

  if (error) return NextResponse.json({ error: "Erro ao listar fontes" }, { status: 500 })
  if (!sources || sources.length === 0) {
    return NextResponse.json({ ok: true, total: 0, updated: 0, skipped: 0, failed: 0, message: "Nenhuma fonte do Notion para sincronizar." })
  }

  // Extrai o notion_page_id de metadata ou, em fontes antigas, do texto da descrição
  function pageIdOf(s: { metadata?: unknown; description?: string | null }): string | null {
    const meta = s.metadata as { notion_page_id?: string } | null
    if (meta?.notion_page_id) return meta.notion_page_id
    const m = (s.description ?? "").match(/ID:\s*([0-9a-fA-F-]{32,36})/)
    return m ? m[1] : null
  }

  let updated = 0, skipped = 0, failed = 0
  const details: string[] = []

  for (const src of sources) {
    const pageId = pageIdOf(src)
    if (!pageId) { failed++; details.push(`${src.name}: sem ID do Notion`); continue }

    try {
      const { title, content } = await fetchPageContent(notion, pageId)
      if (!content.trim()) { skipped++; continue }

      // Atualiza conteúdo/nome e garante metadata com o page id
      await admin.from("knowledge_sources").update({
        content,
        name:     title || src.name,
        metadata: { ...(src.metadata as object ?? {}), notion_page_id: pageId, notion_synced_at: new Date().toISOString() },
      }).eq("id", src.id)

      // Re-indexa (pula via content_hash se nada mudou)
      const result = await indexSource({
        sourceId:   src.id,
        sourceType: "knowledge_source",
        content,
        title:      title || src.name,
        companyId,
        createdBy:  user.id,
      })

      if (result.skipped) skipped++
      else updated++
    } catch (err) {
      failed++
      details.push(`${src.name}: ${err instanceof Error ? err.message : "erro"}`)
    }
  }

  void logActivity({
    userId: user.id, eventType: "source", action: "notion_sync",
    detail: `${updated} atualizada(s), ${skipped} sem mudança, ${failed} falha(s)`, companyId,
  })

  return NextResponse.json({
    ok: true,
    total: sources.length,
    updated, skipped, failed,
    ...(details.length > 0 ? { details } : {}),
  })
}
