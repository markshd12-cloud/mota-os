/**
 * Completion de texto NÃO-streaming via Gemini. SERVER-SIDE ONLY.
 * Usado para tarefas internas determinísticas (ex: extração estruturada de
 * lembretes) — independente do Claude/Anthropic, que pode estar sem crédito.
 *
 * Auth: GEMINI_API_KEY (?key=) ou GOOGLE_SERVICE_ACCOUNT_KEY (Bearer).
 */

import { getServiceAccountToken } from "@/lib/gemini-service-account"

const MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash"
const BASE  = "https://generativelanguage.googleapis.com/v1beta"

async function authParts(): Promise<{ keyParam: string; headers: Record<string, string> }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (apiKey) return { keyParam: `?key=${apiKey}`, headers: { "Content-Type": "application/json" } }
  const token = await getServiceAccountToken()
  if (!token) throw new Error("Sem credenciais Gemini (GEMINI_API_KEY ou GOOGLE_SERVICE_ACCOUNT_KEY).")
  return { keyParam: "", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
}

export async function completeGemini(
  system: string,
  user:   string,
  opts?:  { maxTokens?: number; temperature?: number },
): Promise<string> {
  const { keyParam, headers } = await authParts()
  const res = await fetch(`${BASE}/models/${MODEL}:generateContent${keyParam}`, {
    method:  "POST",
    headers,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents:          [{ role: "user", parts: [{ text: user }] }],
      generationConfig:  { temperature: opts?.temperature ?? 0, maxOutputTokens: opts?.maxTokens ?? 400 },
    }),
  })
  if (!res.ok) {
    throw new Error(`Gemini text ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
  }
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const parts = data.candidates?.[0]?.content?.parts ?? []
  return parts.map(p => p.text ?? "").join("").trim()
}
