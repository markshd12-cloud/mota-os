/**
 * Camada de abstração para provedores de IA.
 * SERVER-SIDE ONLY — nunca importar em Client Components.
 * API keys ficam exclusivamente aqui.
 */

import Anthropic from "@anthropic-ai/sdk"
import OpenAI    from "openai"
import { requestCodexResponse } from "@/lib/codex-client"
import { getValidGeminiToken }        from "@/lib/gemini-auth"
import { getServiceAccountToken }     from "@/lib/gemini-service-account"
import { createGeminiClient, type GeminiContent, type GeminiModel } from "@/lib/api-connectors/gemini"

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type AIProvider = "anthropic" | "openai" | "gemini" | "deepseek"

export interface AIUsage {
  input_tokens:  number
  output_tokens: number
}

export interface AIStreamParams {
  messages:  { role: "user" | "assistant"; content: string }[]
  system?:   string
  provider?: AIProvider
  model?:    string
}

/** Chunk de texto parcial durante o stream */
export interface AIChunkDelta {
  done:  false
  text:  string
}

/** Chunk final com metadados (sem texto) */
export interface AIChunkDone {
  done:     true
  text:     ""
  model:    string
  provider: AIProvider
  usage:    AIUsage
}

/** Chunk de erro — termina o stream */
export interface AIChunkError {
  done:  true
  text:  ""
  error: string
}

export type AIChunk = AIChunkDelta | AIChunkDone | AIChunkError

// ─── Clientes (instanciados uma vez, reutilizados) ────────────────────────────

function getAnthropicClient() {
  // Sem API key estática — o SDK resolve credenciais via WIF (variáveis ANTHROPIC_FEDERATION_*)
  // ou via ANTHROPIC_API_KEY se estiver definida. Não forçar a key aqui.
  return new Anthropic({
    baseURL:    process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    maxRetries: 2,
  })
}

// ─── Entry point público ──────────────────────────────────────────────────────

export async function* streamChat(params: AIStreamParams): AsyncGenerator<AIChunk> {
  const provider = params.provider ?? "anthropic"

  try {
    if (provider === "openai") {
      yield* streamOpenAI(params)
    } else if (provider === "gemini") {
      yield* streamGemini(params)
    } else if (provider === "deepseek") {
      yield* streamDeepseek(params)
    } else {
      yield* streamAnthropic(params)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    yield { done: true, text: "", error: `[${provider}] ${msg}` }
  }
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function* streamAnthropic(params: AIStreamParams): AsyncGenerator<AIChunk> {
  const client = getAnthropicClient()
  const model  = params.model ?? "claude-sonnet-4-6"

  let inputTokens  = 0
  let outputTokens = 0

  const stream = client.messages.stream({
    model,
    max_tokens: 2048,
    system:     params.system ??
      "Você é um assistente de IA para o Grupo Mota Educação. Seja prestativo, objetivo e responda em português.",
    messages: params.messages,
  })

  for await (const event of stream) {
    switch (event.type) {
      case "message_start":
        inputTokens = event.message.usage.input_tokens
        break

      case "content_block_delta":
        if (event.delta.type === "text_delta") {
          yield { done: false, text: event.delta.text }
        }
        break

      case "message_delta":
        outputTokens = event.usage.output_tokens
        break
    }
  }

  yield {
    done:     true,
    text:     "",
    model,
    provider: "anthropic",
    usage:    { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

async function* streamGemini(params: AIStreamParams): AsyncGenerator<AIChunk> {
  // Prioridade: 1. API key  2. Service Account  3. OAuth do usuário
  let token:           string | null = null
  let useServiceAccount              = false

  if (!process.env.GEMINI_API_KEY) {
    token = await getServiceAccountToken()
    if (token) {
      useServiceAccount = true
    } else {
      token = await getValidGeminiToken()
      if (!token) {
        yield { done: true, text: "", error: "[gemini] Sem credenciais. Configure GEMINI_API_KEY, GOOGLE_SERVICE_ACCOUNT_KEY ou autentique via /api/auth/google/login." }
        return
      }
    }
  }

  const model  = (params.model ?? "gemini-2.5-pro") as GeminiModel

  // Service account não envia X-Goog-User-Project (projeto já é implícito)
  const client = useServiceAccount
    ? createGeminiClient(token, {
        defaultModel: "gemini-2.5-pro",
        timeoutMs:    60_000,
        apiBaseUrl:   "https://generativelanguage.googleapis.com/v1beta",
        quotaProject: null,
        apiKey:       null,
      })
    : createGeminiClient(token)
  const contents: GeminiContent[] = params.messages.map((m) => ({
    role:  m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }))

  const result = await client.generate({
    model,
    contents,
    systemInstruction: params.system,
  })

  if (result.text) {
    yield { done: false, text: result.text }
  }

  yield {
    done:     true,
    text:     "",
    model,
    provider: "gemini",
    usage: {
      input_tokens:  result.usage.promptTokenCount,
      output_tokens: result.usage.candidatesTokenCount,
    },
  }
}

// ─── OpenAI-compat helper (GPT + DeepSeek) ──────────────────────────────────────────────

async function* streamOpenAICompat(
  params:   AIStreamParams,
  apiKey:   string,
  baseURL:  string,
  provider: AIProvider,
  defaultModel: string,
): AsyncGenerator<AIChunk> {
  const client = new OpenAI({ apiKey, baseURL })
  const model  = params.model ?? defaultModel

  const messages = [
    ...(params.system ? [{ role: "system" as const, content: params.system }] : []),
    ...params.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ]

  const stream = await client.chat.completions.create({
    model,
    messages,
    stream:         true,
    stream_options: { include_usage: true },
  })

  let inputTokens  = 0
  let outputTokens = 0

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? ""
    if (text) yield { done: false, text }
    if (chunk.usage) {
      inputTokens  = chunk.usage.prompt_tokens
      outputTokens = chunk.usage.completion_tokens
    }
  }

  yield {
    done:     true,
    text:     "",
    model,
    provider,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

async function* streamOpenAI(params: AIStreamParams): AsyncGenerator<AIChunk> {
  const apiKey = process.env.OPENAI_API_KEY

  if (apiKey) {
    yield* streamOpenAICompat(params, apiKey, "https://api.openai.com/v1", "openai", "gpt-4o")
    return
  }

  // Fallback: OAuth/Codex
  const msgs = params.messages.map((m) => ({ role: m.role, content: m.content }))
  if (params.system) msgs.unshift({ role: "assistant", content: params.system })

  const result = await requestCodexResponse(msgs)
  if (!result.ok) {
    yield { done: true, text: "", error: `[openai] ${result.error}` }
    return
  }

  if (result.text) yield { done: false, text: result.text }

  yield {
    done:     true,
    text:     "",
    model:    result.model,
    provider: "openai",
    usage:    result.usage,
  }
}

// ─── DeepSeek ───────────────────────────────────────────────────────────────────

async function* streamDeepseek(params: AIStreamParams): AsyncGenerator<AIChunk> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    yield { done: true, text: "", error: "[deepseek] Configure DEEPSEEK_API_KEY no servidor." }
    return
  }
  yield* streamOpenAICompat(params, apiKey, "https://api.deepseek.com/v1", "deepseek", "deepseek-chat")
}
