/**
 * OpenAI connector — Mota OS (OAuth/Codex)
 * Sem API key estática.
 */

import { requestCodexResponse } from "@/lib/codex-client"

// ─── Config ──────────────────────────────────────────────────────────────────

export interface OpenAIConfig {
  defaultModel:  OpenAIModel
}

function getConfig(): OpenAIConfig {
  return {
    defaultModel: "gpt-5.3-codex",
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type OpenAIModel =
  | "gpt-5.3-codex"

export interface OpenAIMessage {
  role:    "system" | "user" | "assistant"
  content: string
}

export interface OpenAIChatRequest {
  messages:     OpenAIMessage[]
  model?:       OpenAIModel
  max_tokens?:  number
  temperature?: number
}

export interface OpenAIChatResponse {
  id:      string
  model:   string
  content: string
  usage: {
    prompt_tokens:     number
    completion_tokens: number
    total_tokens:      number
  }
}

export interface OpenAIImageRequest {
  prompt:   string
  model?:   "dall-e-3" | "dall-e-2"
  size?:    "1024x1024" | "1792x1024" | "1024x1792"
  quality?: "standard" | "hd"
  n?:       number
}

export interface OpenAIImageResponse {
  created: number
  data:    { url: string; revised_prompt?: string }[]
}

// ─── Pricing (USD per token) ─────────────────────────────────────────────────

const PRICING: Record<OpenAIModel, { in: number; out: number }> = {
  "gpt-5.3-codex": { in: 0, out: 0 },
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class OpenAIClient {
  constructor(private config: OpenAIConfig) {}

  /** Completion síncrona. */
  async chat(request: OpenAIChatRequest): Promise<OpenAIChatResponse> {
    const response = await requestCodexResponse(
      request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    )

    if (!response.ok) {
      throw new Error(response.error || "Falha no OAuth OpenAI")
    }

    return {
      id:      `codex-${Date.now()}`,
      model:   response.model,
      content: response.text,
      usage: {
        prompt_tokens:     response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens:      response.usage.input_tokens + response.usage.output_tokens,
      },
    }
  }

  /** Streaming — yield de tokens de texto conforme chegam. */
  async *stream(request: OpenAIChatRequest): AsyncGenerator<string> {
    const response = await this.chat(request)
    if (response.content) {
      yield response.content
    }
  }

  /** Geração de imagem com DALL-E. */
  async generateImage(request: OpenAIImageRequest): Promise<OpenAIImageResponse> {
    void request
    throw new Error("Geração de imagem não suportada no fluxo OAuth/Codex sem API key")
  }

  /** Custo estimado em USD. */
  estimateCost(promptTokens: number, completionTokens: number, model: OpenAIModel = "gpt-5.3-codex"): number {
    const p = PRICING[model]
    return promptTokens * p.in + completionTokens * p.out
  }
}

export function createOpenAIClient(config = getConfig()): OpenAIClient {
  return new OpenAIClient(config)
}
