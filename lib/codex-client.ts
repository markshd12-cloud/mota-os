import { getAccountIdFromAccessToken, getValidAccessToken } from "@/lib/codex-auth"
import { getCodexResponsesUrl } from "@/lib/codex-oauth"

type ChatMessage = { role: "user" | "assistant"; content: string }

type CodexRequest = {
  model: string
  messages: ChatMessage[]
  store?: boolean
}

type CodexResponse = Record<string, unknown>

function extractAssistantText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return ""
  const data = payload as Record<string, unknown>

  const output = data.output
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== "object") continue
      const msg = item as Record<string, unknown>
      if (msg.type !== "message" || msg.role !== "assistant") continue

      const content = msg.content
      if (!Array.isArray(content)) continue

      const textParts: string[] = []
      for (const c of content) {
        if (!c || typeof c !== "object") continue
        const block = c as Record<string, unknown>
        if (block.type === "output_text" && typeof block.text === "string") {
          textParts.push(block.text)
        }
      }

      if (textParts.length > 0) return textParts.join("\n")
    }
  }

  const choices = data.choices
  if (Array.isArray(choices)) {
    const first = choices[0]
    if (first && typeof first === "object") {
      const message = (first as { message?: { content?: unknown } }).message
      if (typeof message?.content === "string") return message.content
    }
  }

  return ""
}

async function postCodex(accessToken: string, body: CodexRequest): Promise<Response> {
  const accountId = await getAccountIdFromAccessToken()
  const headers: HeadersInit = {
    Authorization: `Bearer ${accessToken}`,
    originator: "zed",
    "OpenAI-Beta": "responses=experimental",
    "Content-Type": "application/json",
  }

  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId
  }

  return fetch(getCodexResponsesUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  })
}

export async function requestCodexResponse(messages: ChatMessage[]) {
  const model = "gpt-5.3-codex"
  const payload: CodexRequest = { model, messages, store: false }

  const token = await getValidAccessToken(false)
  if (!token) {
    return { ok: false as const, status: 401, error: "Usuário não autenticado no OAuth do GPT" }
  }

  let response = await postCodex(token, payload)

  if (response.status === 401) {
    const refreshed = await getValidAccessToken(true)
    if (refreshed) {
      response = await postCodex(refreshed, payload)
    }
  }

  if (!response.ok) {
    const bodyText = await response.text()
    return {
      ok: false as const,
      status: response.status,
      error: bodyText || `Falha ao chamar Codex (${response.status})`,
    }
  }

  const data = await response.json() as CodexResponse
  const text = extractAssistantText(data)

  return {
    ok: true as const,
    status: 200,
    data,
    text,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
    model,
  }
}
