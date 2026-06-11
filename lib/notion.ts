import { Client } from "@notionhq/client"
import { createAdminClient } from "@/lib/supabase-admin"

// ─── Config check ─────────────────────────────────────────────────────────────

export function isNotionConfigured(): boolean {
  return Boolean(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET)
}

// ─── Token storage ────────────────────────────────────────────────────────────

export async function getNotionToken(companyId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("notion_integrations")
    .select("access_token")
    .eq("company_id", companyId)
    .single()
  return data?.access_token ?? null
}

export async function getNotionIntegration(companyId: string): Promise<{
  access_token: string
  workspace_name: string | null
  workspace_icon: string | null
  workspace_id: string | null
  connected_at: string | null
} | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("notion_integrations")
    .select("access_token, workspace_name, workspace_icon, workspace_id, connected_at")
    .eq("company_id", companyId)
    .single()
  return data ?? null
}

// ─── Client factory ───────────────────────────────────────────────────────────

export async function getNotionClientForCompany(companyId: string): Promise<Client | null> {
  const token = await getNotionToken(companyId)
  if (!token) return null
  return new Client({ auth: token })
}

// ─── Rich text extractor ──────────────────────────────────────────────────────

type RichTextItem = { plain_text?: string }

export function extractRichText(richText: unknown): string {
  if (!Array.isArray(richText)) return ""
  return (richText as RichTextItem[]).map(t => t.plain_text ?? "").join("")
}

// ─── Property extractor (para páginas e linhas de database) ───────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PropValue = Record<string, any> & { type?: string }

/** Converte UMA propriedade do Notion em string legível. Retorna null se vazia. */
function propValueToString(prop: PropValue): string | null {
  switch (prop.type) {
    case "title":
      return extractRichText(prop.title) || null
    case "rich_text":
      return extractRichText(prop.rich_text) || null
    case "select":
      return prop.select?.name ?? null
    case "status":
      return prop.status?.name ?? null
    case "multi_select":
      return prop.multi_select?.length
        ? prop.multi_select.map((s: { name: string }) => s.name).join(", ")
        : null
    case "people":
      return prop.people?.length
        ? prop.people.map((u: { name?: string }) => u.name ?? "—").join(", ")
        : null
    case "url":
      return prop.url || null
    case "email":
      return prop.email || null
    case "phone_number":
      return prop.phone_number || null
    case "number":
      return prop.number !== null && prop.number !== undefined ? String(prop.number) : null
    case "checkbox":
      return prop.checkbox ? "Sim" : "Não"
    case "date":
      if (!prop.date) return null
      return prop.date.end ? `${prop.date.start} → ${prop.date.end}` : prop.date.start
    case "created_time":
      return prop.created_time ?? null
    case "last_edited_time":
      return prop.last_edited_time ?? null
    case "unique_id":
      if (!prop.unique_id) return null
      return prop.unique_id.prefix
        ? `${prop.unique_id.prefix}-${prop.unique_id.number}`
        : String(prop.unique_id.number)
    case "files":
      return prop.files?.length
        ? prop.files
            .map((f: { name?: string; external?: { url: string }; file?: { url: string } }) =>
              f.external?.url ?? f.file?.url ?? f.name ?? "",
            )
            .filter(Boolean)
            .join(", ") || null
        : null
    case "relation":
      return prop.relation?.length ? `${prop.relation.length} relacionado(s)` : null
    case "formula": {
      const f = prop.formula
      if (!f) return null
      if (f.string) return f.string
      if (f.number !== null && f.number !== undefined) return String(f.number)
      if (f.boolean !== null && f.boolean !== undefined) return f.boolean ? "Sim" : "Não"
      if (f.date) return f.date.start ?? null
      return null
    }
    case "rollup": {
      const r = prop.rollup
      if (!r) return null
      if (r.type === "number" && r.number !== null && r.number !== undefined) return String(r.number)
      if (r.type === "array" && Array.isArray(r.array))
        return r.array.map((item: PropValue) => propValueToString(item)).filter(Boolean).join(", ") || null
      return null
    }
    default:
      return null
  }
}

/** Extrai título + todas as demais propriedades de um objeto de propriedades. */
function extractPageProperties(properties: Record<string, PropValue>): { title: string; lines: string[] } {
  let title = ""
  const lines: string[] = []

  for (const [name, prop] of Object.entries(properties)) {
    if (prop?.type === "title") {
      title = extractRichText(prop.title)
      continue
    }
    const val = propValueToString(prop)
    if (val) lines.push(`${name}: ${val}`)
  }

  return { title, lines }
}

// ─── Block → texto (blocos simples de página) ─────────────────────────────────

type NotionBlock = { type: string; id: string; has_children?: boolean; [key: string]: unknown }

function blockToText(block: NotionBlock, depth = 0): string {
  const indent = "  ".repeat(depth)
  type Prop = { rich_text: unknown }

  switch (block.type) {
    case "paragraph":
      return extractRichText((block.paragraph as Prop).rich_text)
    case "heading_1":
      return `# ${extractRichText((block.heading_1 as Prop).rich_text)}`
    case "heading_2":
      return `## ${extractRichText((block.heading_2 as Prop).rich_text)}`
    case "heading_3":
      return `### ${extractRichText((block.heading_3 as Prop).rich_text)}`
    case "bulleted_list_item":
      return `${indent}- ${extractRichText((block.bulleted_list_item as Prop).rich_text)}`
    case "numbered_list_item":
      return `${indent}1. ${extractRichText((block.numbered_list_item as Prop).rich_text)}`
    case "to_do": {
      const b = block.to_do as Prop & { checked: boolean }
      return `${indent}${b.checked ? "[x]" : "[ ]"} ${extractRichText(b.rich_text)}`
    }
    case "toggle":
      return `${indent}▶ ${extractRichText((block.toggle as Prop).rich_text)}`
    case "quote":
      return `> ${extractRichText((block.quote as Prop).rich_text)}`
    case "callout": {
      const b = block.callout as Prop & { icon?: { emoji?: string } }
      const emoji = b.icon?.emoji ? `${b.icon.emoji} ` : ""
      return `${emoji}${extractRichText(b.rich_text)}`
    }
    case "code": {
      const b = block.code as Prop & { language?: string }
      return `\`\`\`${b.language ?? ""}\n${extractRichText(b.rich_text)}\n\`\`\``
    }
    case "divider":
      return "---"
    case "image": {
      const b = block.image as { type: string; external?: { url: string }; file?: { url: string }; caption?: unknown }
      const url = b.type === "external" ? b.external?.url : b.file?.url
      const cap = b.caption ? extractRichText(b.caption) : ""
      return cap ? `[Imagem: ${cap}]` : url ? `[Imagem: ${url}]` : ""
    }
    case "table_row": {
      const cells = (block.table_row as { cells: unknown[][] }).cells
      return cells.map(cell => extractRichText(cell)).join(" | ")
    }
    // child_page e child_database são tratados diretamente em processBlocks
    default:
      return ""
  }
}

// ─── Fetch page content ───────────────────────────────────────────────────────

export async function fetchPageContent(
  notion: Client,
  pageId: string,
): Promise<{ title: string; content: string }> {
  let title = "Sem título"
  const lines: string[] = []
  let isPage = false

  // ── 1. Tenta como PÁGINA: extrai título + TODAS as propriedades ──
  try {
    const page = await notion.pages.retrieve({ page_id: pageId })
    isPage = true
    const props = (page as { properties?: Record<string, PropValue> }).properties
    if (props) {
      const { title: pgTitle, lines: propLines } = extractPageProperties(props)
      if (pgTitle) title = pgTitle
      // Propriedades da página (caso de linha de database: aqui estão TODOS os dados)
      for (const l of propLines) lines.push(l)
    }
  } catch {
    // ── 2. Não é página: tenta como DATABASE ──
    try {
      const db = await notion.databases.retrieve({ database_id: pageId })
      title = extractRichText((db as { title?: unknown }).title) || "Sem título"
    } catch { /* usa "Sem título" */ }
  }

  // Resolve os data_source_ids de um database (SDK v5 — query exige data_source_id)
  async function getDataSourceIds(databaseId: string): Promise<string[]> {
    try {
      const db = await notion.databases.retrieve({ database_id: databaseId })
      const ds = (db as { data_sources?: { id: string }[] }).data_sources
      if (Array.isArray(ds) && ds.length > 0) return ds.map(d => d.id)
    } catch { /* fallback abaixo */ }
    // Fallback: em algumas versões o próprio id serve como data_source_id
    return [databaseId]
  }

  // Processa um database: busca TODAS as linhas via dataSources.query
  async function processDatabase(databaseId: string, dbTitle: string, depth: number) {
    if (depth > 4) return
    lines.push(`\n## ${dbTitle}`)

    const dataSourceIds = await getDataSourceIds(databaseId)
    let rowCount = 0

    for (const dsId of dataSourceIds) {
      let cursor: string | undefined
      do {
        let res
        try {
          res = await notion.dataSources.query({
            data_source_id: dsId,
            start_cursor:   cursor,
            page_size:      100,
          })
        } catch { break } // sem acesso a este data source

        for (const row of res.results) {
          if (rowCount >= 500) break
          const p = row as { id: string; properties?: Record<string, PropValue>; has_children?: boolean; object?: string }
          if (p.object !== "page") { rowCount++; continue }

          if (p.properties) {
            const { title: rowTitle, lines: rowLines } = extractPageProperties(p.properties)
            const parts = [rowTitle, ...rowLines].filter(Boolean)
            if (parts.length > 0) lines.push(`- ${parts.join(" | ")}`)
          }

          if (p.has_children && depth < 4) {
            try { await processBlocks(p.id, depth + 1) } catch { /* ignora */ }
          }
          rowCount++
        }

        cursor = res.next_cursor ?? undefined
      } while (cursor && rowCount < 500)
    }
  }

  // Processa blocos de uma página (recursivo)
  async function processBlocks(blockId: string, depth: number) {
    if (depth > 4) return
    let cursor: string | undefined

    do {
      const res = await notion.blocks.children.list({
        block_id:     blockId,
        start_cursor: cursor,
        page_size:    100,
      })

      for (const block of res.results) {
        const b = block as NotionBlock

        // Database filho: resolve data_source_id e consulta as linhas
        if (b.type === "child_database") {
          const dbTitle = (b.child_database as { title: string }).title || "Database"
          try { await processDatabase(b.id, dbTitle, depth + 1) } catch { /* sem acesso */ }
          continue
        }

        // Subpágina: adiciona título e recursiona nos blocos internos
        if (b.type === "child_page") {
          const pgTitle = (b.child_page as { title: string }).title || "Subpágina"
          lines.push(`\n### ${pgTitle}`)
          if (depth < 4) {
            try { await processBlocks(b.id, depth + 1) } catch { /* sem acesso */ }
          }
          continue
        }

        const text = blockToText(b, depth)
        if (text.trim()) lines.push(text)

        if (b.has_children && depth < 4) {
          try { await processBlocks(b.id, depth + 1) } catch { /* ignora */ }
        }
      }

      cursor = res.next_cursor ?? undefined
    } while (cursor)
  }

  // ── 3. Lê o corpo (blocos filhos) ──
  // Para páginas: blocos abaixo das propriedades. Para databases: as linhas.
  if (isPage) {
    try { await processBlocks(pageId, 0) } catch { /* sem corpo acessível */ }
  } else {
    try { await processDatabase(pageId, title, 0) } catch { /* sem acesso */ }
  }

  return { title, content: lines.join("\n") }
}

// ─── Search pages ─────────────────────────────────────────────────────────────

export interface NotionPage {
  id:               string
  title:            string
  type:             "page" | "database"
  url:              string
  icon:             string | null
  last_edited_time: string
}

export async function searchPages(notion: Client, query?: string): Promise<NotionPage[]> {
  const response = await notion.search({
    query:     query ?? "",
    sort:      { direction: "descending", timestamp: "last_edited_time" },
    page_size: 50,
  })

  return response.results.map(result => {
    const r = result as {
      id: string
      object: string
      url: string
      icon?: { type: string; emoji?: string; external?: { url: string } } | null
      last_edited_time: string
      properties?: Record<string, unknown>
      title?:  unknown[]
    }

    let title = "Sem título"
    if (r.object === "page" && r.properties) {
      const tp = Object.values(r.properties).find(
        p => (p as { type?: string }).type === "title",
      ) as { title?: unknown } | undefined
      if (tp?.title) title = extractRichText(tp.title) || "Sem título"
    } else if (r.title) {
      title = extractRichText(r.title) || "Sem título"
    }

    let icon: string | null = null
    if (r.icon?.type === "emoji")    icon = r.icon.emoji    ?? null
    if (r.icon?.type === "external") icon = r.icon.external?.url ?? null

    return {
      id:               r.id,
      title,
      type:             r.object as "page" | "database",
      url:              r.url,
      icon,
      last_edited_time: r.last_edited_time,
    }
  })
}

// ─── Busca automática ao vivo (Data Bricks) ───────────────────────────────────
// Dado termos de busca, encontra as páginas/databases mais relevantes e extrai
// o conteúdo. Usado quando o usuário NÃO selecionou fonte mas pediu dados.

export interface NotionLiveResult {
  title:   string
  content: string
  url:     string
}

export async function searchAndFetch(
  notion: Client,
  queries: string[],
  opts: { maxPages?: number; maxCharsPerPage?: number } = {},
): Promise<NotionLiveResult[]> {
  const maxPages = opts.maxPages ?? 2
  const maxChars = opts.maxCharsPerPage ?? 12_000

  // Agrega resultados de todas as queries, deduplica por id
  const seen = new Set<string>()
  const candidates: NotionPage[] = []
  for (const q of queries.slice(0, 3)) {
    if (!q.trim()) continue
    let pages: NotionPage[] = []
    try { pages = await searchPages(notion, q.trim()) } catch { continue }
    for (const p of pages) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      candidates.push(p)
    }
  }

  // Ranqueia: títulos que casam com os termos da busca + databases ganham prioridade
  // (ex: "cadastro de alunos" deve trazer o DATABASE, não páginas soltas de alunos).
  const terms = queries.join(" ").toLowerCase().split(/\s+/).filter(t => t.length > 2)
  const score = (p: NotionPage): number => {
    const t = p.title.toLowerCase()
    let s = 0
    for (const term of terms) if (t.includes(term)) s += 2
    if (p.type === "database") s += 3   // databases costumam ser a fonte de dados pedida
    return s
  }
  const ranked = [...candidates].sort((a, b) => score(b) - score(a))

  // Extrai conteúdo das melhores
  const results: NotionLiveResult[] = []
  for (const page of ranked.slice(0, maxPages)) {
    try {
      const { title, content } = await fetchPageContent(notion, page.id)
      if (content.trim()) {
        results.push({ title, content: content.slice(0, maxChars), url: page.url })
      }
    } catch { /* ignora páginas sem acesso */ }
  }
  return results
}
