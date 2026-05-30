import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { getAllowedCompanyIds } from "@/lib/company-scope"
import { embedText } from "@/lib/rag/embeddings"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    query:          string
    company_id?:    string
    agent_id?:      string
    source_ids?:    string[]
    k?:             number
    min_similarity?: number
  }

  if (!body.query?.trim()) {
    return NextResponse.json({ error: "query é obrigatória" }, { status: 400 })
  }

  // Validar acesso à empresa solicitada
  if (body.company_id) {
    const allowed = await getAllowedCompanyIds(user.id)
    if (!(allowed as string[]).includes(body.company_id)) {
      return NextResponse.json({ error: "Sem acesso a essa empresa" }, { status: 403 })
    }
  }

  const admin = createAdminClient()

  try {
    const embedding = await embedText(body.query)

    const { data: chunks, error } = await admin.rpc("match_knowledge_chunks", {
      query_embedding:   `[${embedding.join(",")}]`,
      match_count:       body.k             ?? 5,
      filter_company:    body.company_id    ?? null,
      filter_agent_id:   body.agent_id      ?? null,
      filter_source_ids: body.source_ids    ?? null,
      min_similarity:    body.min_similarity ?? 0.4,
    })

    if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

    return NextResponse.json({ results: chunks ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro na busca"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
