/**
 * Sincronização de fontes do Notion → re-extrai conteúdo e re-indexa (embeddings).
 * SERVER-SIDE ONLY. Reutilizado pelo botão manual e pelo cron agendado.
 */

import { createAdminClient } from "@/lib/supabase-admin"
import { getNotionClientForCompany, fetchPageContent } from "@/lib/notion"
import { indexSource } from "@/lib/rag/index-source"
import { logActivity } from "@/lib/activity-logger"

export interface NotionSyncResult {
  total:    number
  updated:  number
  skipped:  number
  failed:   number
  details?: string[]
}

/** Extrai o notion_page_id de metadata ou (fontes antigas) do texto da descrição. */
function pageIdOf(s: { metadata?: unknown; description?: string | null }): string | null {
  const meta = s.metadata as { notion_page_id?: string } | null
  if (meta?.notion_page_id) return meta.notion_page_id
  const m = (s.description ?? "").match(/ID:\s*([0-9a-fA-F-]{32,36})/)
  return m ? m[1] : null
}

/**
 * Sincroniza todas as fontes type="notion" de uma empresa.
 * Retorna null se o Notion não estiver conectado para a empresa.
 */
export async function syncNotionCompany(
  companyId: string,
  actorId?: string,
): Promise<NotionSyncResult | null> {
  const notion = await getNotionClientForCompany(companyId)
  if (!notion) return null

  const admin = createAdminClient()

  const { data: sources, error } = await admin
    .from("knowledge_sources")
    .select("id, name, description, metadata")
    .eq("company_id", companyId)
    .eq("type", "notion")
    .eq("status", "active")

  if (error) throw new Error(error.message)
  if (!sources || sources.length === 0) {
    return { total: 0, updated: 0, skipped: 0, failed: 0 }
  }

  let updated = 0, skipped = 0, failed = 0
  const details: string[] = []

  for (const src of sources) {
    const pageId = pageIdOf(src)
    if (!pageId) { failed++; details.push(`${src.name}: sem ID do Notion`); continue }

    try {
      const { title, content } = await fetchPageContent(notion, pageId)
      if (!content.trim()) { skipped++; continue }

      await admin.from("knowledge_sources").update({
        content,
        name:     title || src.name,
        metadata: { ...(src.metadata as object ?? {}), notion_page_id: pageId, notion_synced_at: new Date().toISOString() },
      }).eq("id", src.id)

      const result = await indexSource({
        sourceId:   src.id,
        sourceType: "knowledge_source",
        content,
        title:      title || src.name,
        companyId,
        createdBy:  actorId,
      })

      if (result.skipped) skipped++
      else updated++
    } catch (err) {
      failed++
      details.push(`${src.name}: ${err instanceof Error ? err.message : "erro"}`)
    }
  }

  void logActivity({
    userId: actorId ?? "system", eventType: "source", action: "notion_sync",
    detail: `${updated} atualizada(s), ${skipped} sem mudança, ${failed} falha(s)`, companyId,
  })

  return { total: sources.length, updated, skipped, failed, ...(details.length > 0 ? { details } : {}) }
}
