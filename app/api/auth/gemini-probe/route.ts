import { NextRequest, NextResponse } from "next/server"
import { getValidGeminiToken }    from "@/lib/gemini-auth"
import { getServiceAccountToken } from "@/lib/gemini-service-account"

async function readJsonOrText(res: Response) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

export async function GET(req: NextRequest) {
  const apiKey       = process.env.GEMINI_API_KEY ?? null
  const quotaProject =
    process.env.GOOGLE_CLOUD_PROJECT
    ?? process.env.GOOGLE_PROJECT_ID
    ?? process.env.GCP_PROJECT
    ?? null
  const model = req.nextUrl.searchParams.get("model") ?? "gemini-2.5-pro"
  const base  = "https://generativelanguage.googleapis.com/v1beta"

  let headers: Record<string, string>
  let authMode: string

  if (apiKey) {
    headers  = { "X-Goog-Api-Key": apiKey, "Content-Type": "application/json" }
    authMode = "api-key"
  } else {
    // Tenta service account primeiro
    const saToken = await getServiceAccountToken()
    if (saToken) {
      headers  = { "Authorization": `Bearer ${saToken}`, "Content-Type": "application/json" }
      authMode = "service-account"
    } else {
      // Fallback: OAuth do usuário
      const token = await getValidGeminiToken(false)
      if (!token) {
        return NextResponse.json({
          ok:       false,
          authMode: "nenhum (sem GOOGLE_SERVICE_ACCOUNT_KEY e sem token OAuth)",
          error:    "Sem credenciais. Configure GOOGLE_SERVICE_ACCOUNT_KEY ou acesse /api/auth/google/login.",
        }, { status: 401 })
      }
      headers = {
        "Authorization": `Bearer ${token}`,
        "Content-Type":  "application/json",
      }
      if (quotaProject) headers["X-Goog-User-Project"] = quotaProject
      authMode = quotaProject
        ? `oauth-bearer + X-Goog-User-Project: ${quotaProject}`
        : "oauth-bearer (sem quota project)"
    }
  }

  const [listRes, generateRes] = await Promise.all([
    fetch(`${base}/models?pageSize=1`, { method: "GET", headers, cache: "no-store" }),
    fetch(`${base}/models/${model}:generateContent`, {
      method:  "POST",
      headers,
      cache:   "no-store",
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Responda apenas com a palavra pong." }] }],
      }),
    }),
  ])

  const [listBody, generateBody] = await Promise.all([
    readJsonOrText(listRes),
    readJsonOrText(generateRes),
  ])

  return NextResponse.json({
    ok:              listRes.ok && generateRes.ok,
    authMode,
    model,
    listModels:      { status: listRes.status,     ok: listRes.ok,     body: listBody     },
    generateContent: { status: generateRes.status, ok: generateRes.ok, body: generateBody },
  })
}
