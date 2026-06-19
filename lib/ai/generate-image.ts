/**
 * Geração de imagem via Gemini (gemini-2.5-flash-image, "Nano Banana").
 * SERVER-SIDE ONLY — nunca importar em Client Components.
 *
 * Autenticação (mesma ordem dos embeddings):
 *   1. GEMINI_API_KEY (se presente) — via ?key=
 *   2. GOOGLE_SERVICE_ACCOUNT_KEY — via Bearer token (service account)
 *
 * Confirmado em runtime: o modelo retorna `inlineData` (PNG base64) quando
 * `generationConfig.responseModalities` inclui "IMAGE".
 */

import { getServiceAccountToken } from "@/lib/gemini-service-account"

export const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image"

const BASE = "https://generativelanguage.googleapis.com/v1beta"

async function authParts(): Promise<{ keyParam: string; headers: Record<string, string> }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (apiKey) {
    return { keyParam: `?key=${apiKey}`, headers: { "Content-Type": "application/json" } }
  }
  const token = await getServiceAccountToken()
  if (!token) {
    throw new Error("Sem credenciais Gemini. Configure GEMINI_API_KEY ou GOOGLE_SERVICE_ACCOUNT_KEY.")
  }
  return { keyParam: "", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
}

export interface GeneratedImage {
  /** Conteúdo da imagem em base64 (sem o prefixo data:). */
  base64:   string
  mimeType: string
  /** Texto/legenda que o modelo pode retornar junto da imagem. */
  text:     string | null
}

interface GeminiPart {
  text?:       string
  inlineData?: { mimeType?: string; data?: string }
}

/**
 * Gera uma imagem a partir de um prompt em linguagem natural.
 * Lança um Error com mensagem acionável em caso de falha (status, modelo
 * indisponível, ou resposta sem imagem).
 */
export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const clean = prompt.trim()
  if (!clean) throw new Error("Prompt vazio para geração de imagem.")

  const { keyParam, headers } = await authParts()
  const res = await fetch(`${BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent${keyParam}`, {
    method:  "POST",
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: clean }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Gemini image ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = await res.json() as {
    candidates?: { content?: { parts?: GeminiPart[] } }[]
  }

  const parts = data.candidates?.[0]?.content?.parts ?? []
  let base64:   string | null = null
  let mimeType  = "image/png"
  let text:     string | null = null

  for (const p of parts) {
    if (p.inlineData?.data) {
      base64   = p.inlineData.data
      mimeType = p.inlineData.mimeType ?? "image/png"
    } else if (p.text) {
      text = (text ?? "") + p.text
    }
  }

  if (!base64) {
    throw new Error("O modelo não retornou imagem (resposta sem inlineData). O prompt pode ter sido recusado por política de conteúdo.")
  }

  return { base64, mimeType, text: text?.trim() || null }
}

/** Converte um erro de geração em mensagem amigável em PT (sem emoji — a UI prefixa). */
export function imageErrorMessage(raw: string): string {
  if (/\b404\b|not found|is not found|not supported|unavailable/i.test(raw)) {
    return "O modelo de imagem do Gemini não está disponível nesta conta/projeto. Verifique se o gemini-2.5-flash-image está habilitado."
  }
  if (/\b40[13]\b|permission|denied|unauthorized/i.test(raw)) {
    return "Sem permissão para gerar imagem com a credencial atual do Gemini."
  }
  if (/\b429\b|quota|rate/i.test(raw)) {
    return "Limite de uso do Gemini atingido para geração de imagem. Tente novamente em instantes."
  }
  if (/sem inlineData|política de conteúdo|content policy|safety/i.test(raw)) {
    return "Não consegui gerar essa imagem — o pedido pode ter sido bloqueado por política de conteúdo. Tente reformular."
  }
  return "Não consegui gerar a imagem agora. Tente novamente."
}
