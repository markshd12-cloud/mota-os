import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { getAllowedCompanyIds, isGlobalAdmin } from "@/lib/company-scope"
import { indexSource, type SourceType } from "@/lib/rag/index-source"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    source_type: SourceType
    source_id:   string
    force?:      boolean
  }

  if (!body.source_type || !body.source_id) {
    return NextResponse.json({ error: "source_type e source_id são obrigatórios" }, { status: 400 })
  }

  const admin = createAdminClient()

  // ── Buscar o registro e verificar acesso ──────────────────────────────────
  let content:   string | null = null
  let title:     string        = ""
  let companyId: string | null = null
  let agentId:   string | null = null

  if (body.source_type === "knowledge_source") {
    const { data: src, error } = await admin
      .from("knowledge_sources")
      .select("id, company_id, name, content")
      .eq("id", body.source_id)
      .single()

    if (error || !src) return NextResponse.json({ error: "Fonte não encontrada" }, { status: 404 })

    companyId = src.company_id as string
    title     = src.name as string
    content   = src.content as string | null

    const allowed = await getAllowedCompanyIds(user.id)
    if (!(allowed as string[]).includes(companyId)) {
      return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
    }

  } else if (body.source_type === "agent_file") {
    const { data: af, error } = await admin
      .from("agent_files")
      .select("id, agent_id, company_id, file_name, extracted_text")
      .eq("id", body.source_id)
      .single()

    if (error || !af) return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 })

    agentId   = af.agent_id as string
    companyId = af.company_id as string | null
    title     = af.file_name as string
    content   = af.extracted_text as string | null

    // Acesso: admin global ou membro da empresa do arquivo
    const adminFlag = await isGlobalAdmin(user.id)
    if (!adminFlag && companyId) {
      const allowed = await getAllowedCompanyIds(user.id)
      if (!(allowed as string[]).includes(companyId)) {
        return NextResponse.json({ error: "Sem acesso" }, { status: 403 })
      }
    }

  } else {
    return NextResponse.json({ error: "source_type inválido" }, { status: 400 })
  }

  if (!content?.trim()) {
    return NextResponse.json({ error: "Sem conteúdo para indexar" }, { status: 422 })
  }

  // ── Indexar ───────────────────────────────────────────────────────────────
  try {
    const result = await indexSource({
      sourceId:     body.source_id,
      sourceType:   body.source_type,
      content:      content,
      title,
      companyId:    companyId ?? undefined,
      agentId:      agentId   ?? undefined,
      createdBy:    user.id,
      forceReindex: body.force ?? false,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao indexar"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
