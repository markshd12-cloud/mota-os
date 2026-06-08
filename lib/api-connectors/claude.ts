import Anthropic from "@anthropic-ai/sdk"
import { getAnthropicAuthOptions } from "@/lib/anthropic-auth"

export type ClaudeModel =
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-haiku-4-5-20251001"

export interface ClaudeMessage {
  role:    "user" | "assistant"
  content: string
}

export interface ClaudeChatRequest {
  messages:     ClaudeMessage[]
  model?:       ClaudeModel
  system?:      string
  max_tokens?:  number
  temperature?: number
}

export interface ClaudeChatResponse {
  id:          string
  model:       string
  content:     string
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
}

const PRICING: Record<ClaudeModel, { in: number; out: number }> = {
  "claude-opus-4-6":           { in: 0.000015,  out: 0.000075  },
  "claude-sonnet-4-6":         { in: 0.000003,  out: 0.000015  },
  "claude-haiku-4-5-20251001": { in: 0.0000008, out: 0.000004  },
}

export class ClaudeClient {
  private defaultModel: ClaudeModel = "claude-sonnet-4-6"

  // Cria o SDK com credenciais frescas a cada chamada.
  // getAnthropicAuthOptions() retorna do cache em memória no hot path —
  // chamada ao Auth0 só ocorre em cold start ou quando o token expira.
  private async getSDK(): Promise<Anthropic> {
    const authOptions = await getAnthropicAuthOptions()
    return new Anthropic({
      ...authOptions,
      baseURL:    process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      maxRetries: 2,
    })
  }

  async chat(request: ClaudeChatRequest): Promise<ClaudeChatResponse> {
    const sdk = await this.getSDK()

    const response = await sdk.messages.create({
      model:      request.model      ?? this.defaultModel,
      max_tokens: request.max_tokens ?? 4096,
      system:     request.system,
      messages:   request.messages,
      ...(request.temperature !== undefined && { temperature: request.temperature }),
    })

    const textBlock = response.content.find((b) => b.type === "text")
    const text = textBlock?.type === "text" ? textBlock.text : ""

    return {
      id:          response.id,
      model:       response.model,
      content:     text,
      stop_reason: response.stop_reason ?? "end_turn",
      usage: {
        input_tokens:  response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    }
  }

  async *stream(request: ClaudeChatRequest): AsyncGenerator<string> {
    const sdk = await this.getSDK()

    const stream = sdk.messages.stream({
      model:      request.model      ?? this.defaultModel,
      max_tokens: request.max_tokens ?? 4096,
      system:     request.system,
      messages:   request.messages,
      ...(request.temperature !== undefined && { temperature: request.temperature }),
    })

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text
      }
    }
  }

  estimateCost(inputTokens: number, outputTokens: number, model: ClaudeModel = "claude-sonnet-4-6"): number {
    const p = PRICING[model]
    return inputTokens * p.in + outputTokens * p.out
  }
}

export const claudeClient = new ClaudeClient()
