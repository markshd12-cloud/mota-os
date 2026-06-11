import { completeText } from "@/lib/ai-service"

// Tool router multi-fonte (Data Bricks).
// Um modelo rápido (Haiku) lê o pedido do usuário e decide QUAIS fontes
// consultar e com quais termos de busca. Extensível: registrar novas fontes
// é só adicionar um item em `tools` na chamada.

export interface ToolDef {
  id:          string   // identificador estável (ex: "notion", "knowledge_base")
  description: string   // descrição para o planner saber quando usar
}

export interface ToolCall {
  tool:    string
  queries: string[]
}

/**
 * Decide quais ferramentas acionar para responder a mensagem.
 * Retorna lista vazia quando nenhuma busca é necessária (saudações, etc.).
 */
export async function routeTools(userMessage: string, tools: ToolDef[]): Promise<ToolCall[]> {
  const msg = userMessage.trim()
  if (msg.length < 3 || tools.length === 0) return []

  const toolList = tools.map(t => `- "${t.id}": ${t.description}`).join("\n")

  const system = `Você é um roteador de busca de dados. Dada a mensagem do usuário, decida em QUAIS fontes buscar para responder bem, e com quais termos.

Fontes disponíveis:
${toolList}

Responda APENAS com JSON válido, sem texto extra:
{"calls": [{"tool": "<id>", "queries": ["termo1", "termo2"]}]}

Regras:
- Inclua uma fonte só se ela realmente ajudar a responder. Pode incluir várias, uma, ou nenhuma.
- Para saudações, conversa fiada ou conhecimento geral que não dependa de dados internos: {"calls": []}.
- queries: 1 a 3 termos curtos e objetivos (substantivos-chave) em português por fonte.
- Use exatamente os ids listados acima.`

  try {
    const raw = await completeText({
      system,
      messages:  [{ role: "user", content: msg.slice(0, 1500) }],
      model:     "claude-haiku-4-5",
      maxTokens: 300,
    })
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return []
    const parsed = JSON.parse(match[0]) as { calls?: unknown }
    if (!Array.isArray(parsed.calls)) return []

    const validIds = new Set(tools.map(t => t.id))
    const out: ToolCall[] = []
    for (const c of parsed.calls) {
      const call = c as { tool?: unknown; queries?: unknown }
      if (typeof call.tool !== "string" || !validIds.has(call.tool)) continue
      const queries = Array.isArray(call.queries)
        ? call.queries.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 3)
        : []
      if (queries.length > 0) out.push({ tool: call.tool, queries })
    }
    return out
  } catch {
    return []
  }
}
