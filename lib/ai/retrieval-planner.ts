import { completeText } from "@/lib/ai-service"

// Planner leve de recuperação (Data Bricks).
// Dado o que o usuário pediu, decide se vale buscar dados em fontes externas
// (ex: Notion) e quais termos de busca usar. Roda com Haiku — rápido e barato.

export interface RetrievalPlan {
  search:  boolean    // precisa buscar dados externos?
  queries: string[]   // termos de busca (1-3), vazios se search=false
}

const SYSTEM = `Você é um roteador de busca. Analise a mensagem do usuário e decida se, para respondê-la bem, é preciso buscar DADOS ou DOCUMENTOS em bases de conhecimento (ex: cadastros, planilhas, playbooks, fichas, relatórios, páginas de Notion).

Responda APENAS com JSON válido, sem texto extra, no formato:
{"search": true|false, "queries": ["termo1", "termo2"]}

Regras:
- search=true quando a mensagem pede informações específicas, dados, registros, conteúdo de documento, "me dê", "qual", "quanto", "lista de", "cadastro de", "dados de", etc.
- search=false para saudações, conversa fiada, perguntas de conhecimento geral, pedidos de redação/criação que não dependem de dados internos.
- queries: 1 a 3 termos curtos e objetivos para busca (substantivos-chave), em português. Ex: ["cadastro de alunos", "matrícula"].
- Se search=false, queries=[].`

export async function planRetrieval(userMessage: string): Promise<RetrievalPlan> {
  const fallback: RetrievalPlan = { search: false, queries: [] }
  const msg = userMessage.trim()
  if (msg.length < 3) return fallback

  try {
    const raw = await completeText({
      system:    SYSTEM,
      messages:  [{ role: "user", content: msg.slice(0, 1500) }],
      model:     "claude-haiku-4-5",
      maxTokens: 200,
    })
    // Extrai o primeiro objeto JSON da resposta
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return fallback
    const parsed = JSON.parse(match[0]) as { search?: boolean; queries?: unknown }
    const queries = Array.isArray(parsed.queries)
      ? parsed.queries.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 3)
      : []
    return { search: Boolean(parsed.search) && queries.length > 0, queries }
  } catch {
    return fallback
  }
}
