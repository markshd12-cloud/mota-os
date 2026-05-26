import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin }     from "@/lib/company-scope"
import { logActivity }       from "@/lib/activity-logger"
import Anthropic from "@anthropic-ai/sdk"
import OpenAI    from "openai"
import { requestCodexResponse }   from "@/lib/codex-client"
import { getServiceAccountToken } from "@/lib/gemini-service-account"
import { getValidGeminiToken }    from "@/lib/gemini-auth"

const PROVIDER_NAMES: Record<string, string> = {
  anthropic:    "Anthropic (Claude)",
  openai:       "OpenAI (GPT)",
  deepseek:     "DeepSeek",
  gemini:       "Google Gemini",
  supabase:     "Supabase",
  rocketchat:   "Rocket.Chat",
  meta_ads:     "Meta Ads",
  google_ads:   "Google Ads",
  ga4:          "Google Analytics 4",
  reportei:     "Reportei",
  whatsapp:     "WhatsApp Business",
  google_drive: "Google Drive",
}

const PENDING_PROVIDERS = new Set([
  "meta_ads", "google_ads", "ga4", "reportei", "whatsapp", "google_drive",
])

// ─── POST — testa conexão real com o provedor ─────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // Testar conexões altera o status no banco e dispara chamadas com credenciais
  // de produção — restrito a administradores.
  if (!(await isGlobalAdmin(user.id))) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })
  }

  const { provider } = await req.json() as { provider: string }

  if (!provider) {
    return NextResponse.json({ error: "provider obrigatório" }, { status: 400 })
  }

  const admin = createAdminClient()

  // Fetch config from DB
  const { data: row } = await admin
    .from("api_connections")
    .select("config")
    .eq("provider", provider)
    .maybeSingle()

  const config = (row?.config ?? {}) as Record<string, string>

  let testOk   = false
  let errMsg   = ""
  let pending  = false

  if (PENDING_PROVIDERS.has(provider)) {
    pending = true
    errMsg  = "Teste real ainda não implementado para este provedor. Salve as credenciais para marcar como configurado."
  } else {
    try {
      switch (provider) {
        case "anthropic": {
          const client = new Anthropic({
            baseURL: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
            maxRetries: 1,
          })
          await client.messages.create({
            model:    "claude-3-5-haiku-latest",
            max_tokens: 1,
            messages: [{ role: "user", content: "ping" }],
          })
          testOk = true
          break
        }

        case "openai": {
          const openaiKey = process.env.OPENAI_API_KEY
          if (openaiKey) {
            const client = new OpenAI({ apiKey: openaiKey })
            await client.chat.completions.create({
              model:      "gpt-4o-mini",
              messages:   [{ role: "user", content: "ping" }],
              max_tokens: 1,
            })
            testOk = true
            errMsg = "Autenticado via OPENAI_API_KEY"
          } else {
            const test = await requestCodexResponse([{ role: "user", content: "ping" }])
            if (!test.ok) throw new Error(test.error || "OAuth GPT não autenticado")
            testOk = true
            errMsg = "Autenticado via OAuth/Codex"
          }
          break
        }

        case "deepseek": {
          const deepseekKey = process.env.DEEPSEEK_API_KEY
          if (!deepseekKey) throw new Error("DEEPSEEK_API_KEY não configurado no servidor")
          const client = new OpenAI({ apiKey: deepseekKey, baseURL: "https://api.deepseek.com/v1" })
          await client.chat.completions.create({
            model:      "deepseek-chat",
            messages:   [{ role: "user", content: "ping" }],
            max_tokens: 1,
          })
          testOk = true
          break
        }

        case "gemini": {
          // Tenta service account → OAuth → API key
          let geminiToken: string | null = null
          let authMode = ""

          const apiKey = process.env.GEMINI_API_KEY ?? null
          if (apiKey) {
            authMode = "api-key"
          } else {
            geminiToken = await getServiceAccountToken()
            if (geminiToken) {
              authMode = "service-account"
            } else {
              geminiToken = await getValidGeminiToken()
              if (geminiToken) authMode = "oauth"
            }
          }

          if (!apiKey && !geminiToken) {
            throw new Error("Sem credenciais Gemini. Configure GOOGLE_SERVICE_ACCOUNT_KEY no servidor.")
          }

          const headers: Record<string, string> = { "Content-Type": "application/json" }
          if (apiKey) {
            headers["X-Goog-Api-Key"] = apiKey
          } else {
            headers["Authorization"] = `Bearer ${geminiToken}`
          }

          const res = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: "ping" }] }],
              }),
            },
          )
          if (!res.ok) {
            const body = await res.text()
            throw new Error(`Gemini ${res.status}: ${body}`)
          }
          testOk = true
          errMsg = `Autenticado via ${authMode}`
          break
        }

        case "supabase": {
          const url = process.env.NEXT_PUBLIC_SUPABASE_URL
          const key = process.env.SUPABASE_SERVICE_ROLE_KEY
          if (!url || !key) {
            throw new Error(
              "Variáveis de ambiente NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY não configuradas"
            )
          }
          const res = await fetch(`${url}/rest/v1/`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` },
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          testOk = true
          break
        }

        case "rocketchat": {
          const mode = config.mode ?? "rest"
          if (mode === "webhook") {
            const { webhook_url, default_channel, alias } = config
            if (!webhook_url) throw new Error("webhook_url é obrigatório")
            const res = await fetch(webhook_url, {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                alias:   alias || "Jarvis",
                channel: default_channel || "",
                text:    "✅ Teste de conexão do Jarvis com Rocket.Chat realizado com sucesso.",
              }),
            })
            if (!res.ok) {
              let errBody = ""
              try { errBody = await res.text() } catch { /* noop */ }
              throw new Error(`HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ""}`)
            }
          } else {
            const { url, user_id, auth_token } = config
            if (!url || !user_id || !auth_token) {
              throw new Error("url, user_id e auth_token são obrigatórios")
            }
            const res = await fetch(`${url.replace(/\/$/, "")}/api/v1/me`, {
              headers: { "X-Auth-Token": auth_token, "X-User-Id": user_id },
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
          }
          testOk = true
          break
        }

        default:
          throw new Error(`Provedor desconhecido: ${provider}`)
      }
    } catch (err: unknown) {
      errMsg = err instanceof Error ? err.message : "Erro desconhecido"
    }
  }

  const newStatus = pending ? "configured" : (testOk ? "connected" : "error")
  const now       = new Date().toISOString()

  // Update existing row status
  const { data: updated } = await admin
    .from("api_connections")
    .update({
      status:         newStatus,
      last_tested_at: now,
      error_message:  testOk ? null : errMsg,
    })
    .eq("provider", provider)
    .select("id")

  // If no row existed yet (e.g., supabase tested without saving), create one
  if (!updated || updated.length === 0) {
    await admin.from("api_connections").insert({
      provider,
      name:           PROVIDER_NAMES[provider] ?? provider,
      status:         newStatus,
      config:         {},
      last_tested_at: now,
      error_message:  testOk ? null : errMsg,
    })
  }

  void logActivity({
    userId:    user.id,
    eventType: "api",
    action:    "Conexão de API testada",
    detail:    `${PROVIDER_NAMES[provider] ?? provider} — ${newStatus}`,
    metadata:  { provider, status: newStatus, pending, error: errMsg || null },
  })

  return NextResponse.json({
    ok:      testOk,
    pending,
    status:  newStatus,
    message: errMsg,
  })
}
