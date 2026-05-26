// claude.ts — sem imports problemáticos, SDK resolve WIF automaticamente

import Anthropic from "@anthropic-ai/sdk"

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
  private sdk: Anthropic
  private defaultModel: ClaudeModel = "claude-sonnet-4-6"

  constructor() {
    // WIF (Workload Identity Federation) — sem API key estática.
    // O SDK lê automaticamente as variáveis de ambiente:
    //   ANTHROPIC_FEDERATION_RULE_ID   → ID da regra (fdrl_...)
    //   ANTHROPIC_ORGANIZATION_ID      → UUID da organização
    //   ANTHROPIC_SERVICE_ACCOUNT_ID   → ID da service account (svac_...)
    //   ANTHROPIC_IDENTITY_TOKEN_FILE  → caminho do JWT emitido pelo GitHub Actions
    //   ANTHROPIC_WORKSPACE_ID         → opcional; omitir quando a regra usa "todos os workspaces"
    // Se ANTHROPIC_API_KEY estiver definida, ela tem precedência e silencia o WIF.
    this.sdk = new Anthropic({
      baseURL:    process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      maxRetries: 2,
    })
  }

  async chat(request: ClaudeChatRequest): Promise<ClaudeChatResponse> {
    const response = await this.sdk.messages.create({
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
    const stream = this.sdk.messages.stream({
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
