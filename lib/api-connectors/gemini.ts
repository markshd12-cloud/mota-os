/**
 * Google Gemini connector — Mota OS
 *
 * Autenticação (ordem de prioridade):
 *   1. GEMINI_API_KEY — header X-Goog-Api-Key (override estático)
 *   2. OAuth 2.0 bearer token — Authorization: Bearer <token>
 *      Requer scope generative-language.peruserquota (ou cloud-platform).
 *      NÃO usa X-Goog-User-Project; a quota vem do plano do próprio usuário.
 */

// ─── Config ──────────────────────────────────────────────────────────────────

export interface GeminiConfig {
  defaultModel: GeminiModel
  timeoutMs:    number
  apiBaseUrl:   string
  /** Projeto GCP para X-Goog-User-Project (GOOGLE_CLOUD_PROJECT). */
  quotaProject: string | null
  /** Override estático via env GEMINI_API_KEY. Quando presente, ignora OAuth. */
  apiKey:       string | null
}

function getConfig(): GeminiConfig {
  return {
    defaultModel: "gemini-2.5-pro",
    timeoutMs:    60_000,
    apiBaseUrl:   "https://generativelanguage.googleapis.com/v1beta",
    quotaProject:
      process.env.GOOGLE_CLOUD_PROJECT
      ?? process.env.GOOGLE_PROJECT_ID
      ?? process.env.GCP_PROJECT
      ?? null,
    apiKey: process.env.GEMINI_API_KEY ?? null,
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type GeminiModel =
  | "gemini-2.5-pro"
  | "gemini-2.5-flash"
  | "gemini-2.0-flash"
  | "gemini-2.0-flash-lite"
  | "gemini-1.5-pro"
  | "gemini-1.5-flash"

export interface GeminiPart {
  text: string
}

export interface GeminiContent {
  role:  "user" | "model"
  parts: GeminiPart[]
}

export interface GeminiGenerateRequest {
  model?:             GeminiModel
  contents:           GeminiContent[]
  systemInstruction?: string
  maxOutputTokens?:   number
  temperature?:       number
}

export interface GeminiGenerateResponse {
  text:  string
  model: GeminiModel
  usage: {
    promptTokenCount:     number
    candidatesTokenCount: number
    totalTokenCount:      number
  }
}

// ─── Pricing (USD per token) ─────────────────────────────────────────────────

const PRICING: Record<GeminiModel, { in: number; out: number }> = {
  "gemini-2.5-pro":        { in: 0.00000125,   out: 0.00001     },
  "gemini-2.5-flash":      { in: 0.0000003,    out: 0.0000025   },
  "gemini-2.0-flash":      { in: 0.000000075,  out: 0.0000003   },
  "gemini-2.0-flash-lite": { in: 0.0000000375, out: 0.00000015  },
  "gemini-1.5-pro":        { in: 0.00000125,   out: 0.000005    },
  "gemini-1.5-flash":      { in: 0.000000075,  out: 0.0000003   },
}

// ─── Internals: tipos crus da Generative Language API ────────────────────────

interface GLAPart {
  text?: string
}

interface GLAContent {
  role?: "user" | "model"
  parts: GLAPart[]
}

interface GLAUsageMetadata {
  promptTokenCount?:     number
  candidatesTokenCount?: number
  totalTokenCount?:      number
}

interface GLAResponse {
  candidates?:    { content?: GLAContent }[]
  usageMetadata?: GLAUsageMetadata
}

function buildBody(request: GeminiGenerateRequest) {
  const generationConfig: Record<string, number> = {}
  if (request.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = request.maxOutputTokens
  if (request.temperature     !== undefined) generationConfig.temperature     = request.temperature

  return {
    contents: request.contents,
    ...(request.systemInstruction && {
      systemInstruction: { parts: [{ text: request.systemInstruction }] },
    }),
    ...(Object.keys(generationConfig).length > 0 && { generationConfig }),
  }
}

function extractText(payload: GLAResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? []
  return parts.map((p) => p.text ?? "").join("")
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class GeminiClient {
  constructor(
    private config:      GeminiConfig,
    private accessToken: string | null = null,
  ) {}

  private buildAuthHeaders(): Record<string, string> {
    if (this.config.apiKey) {
      return {
        "X-Goog-Api-Key": this.config.apiKey,
        "Content-Type":   "application/json",
      }
    }
    if (this.accessToken) {
      const headers: Record<string, string> = {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type":  "application/json",
      }
      if (this.config.quotaProject) {
        headers["X-Goog-User-Project"] = this.config.quotaProject
      }
      return headers
    }
    throw new Error("[gemini] Sem credenciais: configure GEMINI_API_KEY ou autentique via Google OAuth.")
  }

  async generate(request: GeminiGenerateRequest): Promise<GeminiGenerateResponse> {
    const model   = request.model ?? this.config.defaultModel
    const url     = `${this.config.apiBaseUrl}/models/${model}:generateContent`
    const headers = this.buildAuthHeaders()

    const res = await fetch(url, {
      method:  "POST",
      headers,
      body:   JSON.stringify(buildBody(request)),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    if (!res.ok) {
      throw new Error(`Gemini ${res.status}: ${await res.text()}`)
    }

    const data  = await res.json() as GLAResponse
    const usage = data.usageMetadata ?? {}

    return {
      text:  extractText(data),
      model,
      usage: {
        promptTokenCount:     usage.promptTokenCount     ?? 0,
        candidatesTokenCount: usage.candidatesTokenCount ?? 0,
        totalTokenCount:      usage.totalTokenCount      ?? 0,
      },
    }
  }

  async *stream(request: GeminiGenerateRequest): AsyncGenerator<string> {
    const model   = request.model ?? this.config.defaultModel
    const url     = `${this.config.apiBaseUrl}/models/${model}:streamGenerateContent?alt=sse`
    const headers = this.buildAuthHeaders()

    const res = await fetch(url, {
      method:  "POST",
      headers,
      body:   JSON.stringify(buildBody(request)),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    if (!res.ok || !res.body) {
      throw new Error(`Gemini ${res.status}: ${await res.text()}`)
    }

    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer    = ""

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let idx: number
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const event = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)

          for (const line of event.split("\n")) {
            if (!line.startsWith("data: ")) continue
            const raw = line.slice(6).trim()
            if (!raw) continue

            try {
              const payload = JSON.parse(raw) as GLAResponse
              const text = extractText(payload)
              if (text) yield text
            } catch {
              // linha mal-formada: ignora
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  estimateCost(promptTokens: number, outputTokens: number, model: GeminiModel = "gemini-2.5-pro"): number {
    const p = PRICING[model]
    return promptTokens * p.in + outputTokens * p.out
  }
}

export function createGeminiClient(accessToken: string | null = null, config = getConfig()): GeminiClient {
  return new GeminiClient(config, accessToken)
}
