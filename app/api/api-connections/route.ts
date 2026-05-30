import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { logActivity }       from "@/lib/activity-logger"
import { isGlobalAdmin }     from "@/lib/company-scope"

export const dynamic = "force-dynamic"

const KNOWN_PROVIDERS = [
  "anthropic", "openai", "gemini", "supabase", "rocketchat",
  "meta_ads", "google_ads", "ga4", "reportei", "whatsapp", "google_drive",
] as const

const PROVIDER_NAMES: Record<string, string> = {
  anthropic:    "Anthropic (Claude)",
  openai:       "OpenAI",
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

const SECRET_KEYS = new Set([
  "api_key", "auth_token", "token", "developer_token", "access_token", "webhook_url",
])

function maskConfig(config: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(config)) {
    if (typeof v !== "string" || v.length === 0) continue
    out[k] = SECRET_KEYS.has(k)
      ? (v.length <= 4 ? "****" : `****${v.slice(-4)}`)
      : v
  }
  return out
}

// ─── GET — lista todas as conexões mesclada com KNOWN_PROVIDERS ───────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  const { data: rows, error } = await admin
    .from("api_connections")
    .select("id, provider, status, config, last_tested_at, error_message, updated_at")

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  const dbMap = new Map((rows ?? []).map((r) => [r.provider, r]))

  const result = KNOWN_PROVIDERS.map((provider) => {
    const row = dbMap.get(provider)
    return {
      id:            row?.id            ?? null,
      provider,
      name:          PROVIDER_NAMES[provider] ?? provider,
      status:        row?.status        ?? "not_configured",
      config:        row ? maskConfig(row.config as Record<string, unknown>) : {},
      last_tested_at: row?.last_tested_at ?? null,
      error_message: row?.error_message ?? null,
      updated_at:    row?.updated_at    ?? null,
    }
  })

  return NextResponse.json(result)
}

// ─── PATCH — upsert configuração de uma conexão ───────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const adminUser = await isGlobalAdmin(user.id)
  if (!adminUser) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })

  const body = await req.json() as {
    provider: string
    config?:  Record<string, string>
  }

  const { provider, config: incoming = {} } = body

  if (!provider || !KNOWN_PROVIDERS.includes(provider as typeof KNOWN_PROVIDERS[number])) {
    return NextResponse.json({ error: "provider inválido" }, { status: 400 })
  }

  const admin = createAdminClient()

  // Fetch existing to merge config safely
  const { data: existing } = await admin
    .from("api_connections")
    .select("config")
    .eq("provider", provider)
    .maybeSingle()

  const existingConfig = (existing?.config ?? {}) as Record<string, string>

  // Merge: only apply non-masked, non-empty incoming values
  const merged = { ...existingConfig }
  for (const [k, v] of Object.entries(incoming)) {
    if (v && !v.startsWith("****")) {
      merged[k] = v
    }
  }

  const { data, error } = await admin
    .from("api_connections")
    .upsert(
      {
        provider,
        name:       PROVIDER_NAMES[provider] ?? provider,
        status:     "configured",
        config:     merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider" },
    )
    .select("id, status, updated_at")
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "api",
    action:    existing ? "Conexão de API atualizada" : "Conexão de API criada",
    detail:    PROVIDER_NAMES[provider] ?? provider,
    metadata:  { provider, status: data.status },
  })

  return NextResponse.json({ ok: true, id: data.id, status: data.status, updated_at: data.updated_at })
}

// ─── DELETE — remove uma conexão por provider ─────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const adminUser = await isGlobalAdmin(user.id)
  if (!adminUser) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })

  const body = await req.json() as { provider?: string; id?: string }

  if (!body.provider && !body.id) {
    return NextResponse.json({ error: "provider ou id obrigatório" }, { status: 400 })
  }

  const admin = createAdminClient()

  const query = body.id
    ? admin.from("api_connections").delete().eq("id", body.id)
    : admin.from("api_connections").delete().eq("provider", body.provider!)

  const { error } = await query

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  void logActivity({
    userId:    user.id,
    eventType: "api",
    action:    "Conexão de API removida",
    detail:    body.provider ? (PROVIDER_NAMES[body.provider] ?? body.provider) : body.id ?? "",
    metadata:  { provider: body.provider ?? null, id: body.id ?? null },
  })

  return NextResponse.json({ ok: true })
}
