import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { logActivity }       from "@/lib/activity-logger"
import { getAllowedCompanyIds } from "@/lib/company-scope"
import { fetchWithTimeout }     from "@/lib/security"
import { parseBody, rocketchatSendSchema } from "@/lib/validators"
import { rateLimit }            from "@/lib/rate-limit"

const SEND_TIMEOUT_MS = 10_000

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface RCDest {
  id:          string
  mode:        string
  webhook_url: string | null
  base_url:    string | null
  user_id:     string | null
  auth_token:  string | null
  channel:     string
  alias:       string | null
  avatar:      string | null
  type:        string
}

// ─── Resolver destino ─────────────────────────────────────────────────────────
// Cadeia: destination_id → default do tipo (empresa) → default do tipo (global) → fallback chat

async function resolveDest(
  admin:            ReturnType<typeof createAdminClient>,
  userId:           string,
  destinationId?:   string,
  destinationType?: string,
  companyId?:       string,
): Promise<{ dest: RCDest | null; source: string }> {

  const allowed = await getAllowedCompanyIds(userId)

  // 1. Destino explícito por ID
  if (destinationId) {
    const { data } = await admin
      .from("rocketchat_destinations")
      .select("id,mode,webhook_url,base_url,user_id,auth_token,channel,alias,avatar,type,company_id")
      .eq("id", destinationId)
      .is("deleted_at", null)
      .neq("status", "inactive")
      .single()

    if (data) {
      const d = data as RCDest & { company_id: string | null }
      if (!d.company_id || (allowed as string[]).includes(d.company_id)) {
        return { dest: d, source: "id" }
      }
    }
    return { dest: null, source: "id" }
  }

  // 2. Destino padrão por tipo
  const type          = destinationType ?? "chat"
  const companyFilter = companyId ?? (allowed.length > 0 ? allowed[0] : null)

  // Empresa-específico tem prioridade sobre global
  if (companyFilter) {
    const { data } = await admin
      .from("rocketchat_destinations")
      .select("id,mode,webhook_url,base_url,user_id,auth_token,channel,alias,avatar,type")
      .eq("type", type)
      .eq("is_default", true)
      .eq("company_id", companyFilter)
      .is("deleted_at", null)
      .neq("status", "inactive")
      .limit(1)
      .maybeSingle()

    if (data) return { dest: data as RCDest, source: "company_default" }
  }

  // Global (company_id IS NULL)
  const { data } = await admin
    .from("rocketchat_destinations")
    .select("id,mode,webhook_url,base_url,user_id,auth_token,channel,alias,avatar,type")
    .eq("type", type)
    .eq("is_default", true)
    .is("company_id", null)
    .is("deleted_at", null)
    .neq("status", "inactive")
    .limit(1)
    .maybeSingle()

  if (data) return { dest: data as RCDest, source: "global_default" }

  // 3. Fallback: qualquer destino tipo "chat" global (se tipo solicitado for diferente)
  if (type !== "chat") {
    const { data: fallback } = await admin
      .from("rocketchat_destinations")
      .select("id,mode,webhook_url,base_url,user_id,auth_token,channel,alias,avatar,type")
      .eq("type", "chat")
      .eq("is_default", true)
      .is("company_id", null)
      .is("deleted_at", null)
      .neq("status", "inactive")
      .limit(1)
      .maybeSingle()

    if (fallback) return { dest: fallback as RCDest, source: "chat_fallback" }
  }

  return { dest: null, source: "none" }
}

// ─── Envio via webhook ────────────────────────────────────────────────────────

async function sendWebhook(dest: RCDest, message: string, channelOverride?: string): Promise<void> {
  if (!dest.webhook_url) throw new Error("webhook_url não configurado neste destino")

  const target = channelOverride?.trim() || dest.channel
  const body: Record<string, string> = {
    alias:   dest.alias ?? "Jarvis",
    channel: target,
    text:    message.trim(),
  }
  if (dest.avatar) body.avatar = dest.avatar

  const res = await fetchWithTimeout(dest.webhook_url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    timeoutMs: SEND_TIMEOUT_MS,
  })

  if (!res.ok) {
    let errBody = ""
    try { errBody = await res.text() } catch { /* noop */ }
    throw new Error(`HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ""}`)
  }
}

// ─── Envio via REST ───────────────────────────────────────────────────────────

async function sendRest(dest: RCDest, message: string, channelOverride?: string): Promise<void> {
  if (!dest.base_url || !dest.user_id || !dest.auth_token) {
    throw new Error("base_url, user_id e auth_token são obrigatórios no modo REST")
  }

  const raw = channelOverride?.trim() || dest.channel
  const channel = raw.startsWith("#") || raw.startsWith("@") ? raw : `#${raw}`

  const res = await fetchWithTimeout(`${dest.base_url.replace(/\/$/, "")}/api/v1/chat.postMessage`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": dest.auth_token,
      "X-User-Id":    dest.user_id,
    },
    body: JSON.stringify({ channel, text: message.trim() }),
    timeoutMs: SEND_TIMEOUT_MS,
  })

  const rcJson = await res.json() as { success?: boolean; error?: string }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${rcJson.error ?? JSON.stringify(rcJson)}`)
  if (rcJson.success === false) throw new Error(rcJson.error ?? "Rocket.Chat retornou success: false")
}

// ─── POST — enviar mensagem ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  // Rate limit por user — 30 mensagens/min (anti-spam).
  const rl = rateLimit(`rocketchat-send:${user.id}`, { limit: 30, windowMs: 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Muitas mensagens enviadas. Aguarde alguns segundos." },
      { status: 429, headers: { "Retry-After": String(rl.resetIn) } },
    )
  }

  const parsed = await parseBody(req, rocketchatSendSchema)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const body = parsed.data
  const { message } = body

  const admin = createAdminClient()

  // Resolver destino pela chain
  const { dest, source } = await resolveDest(
    admin,
    user.id,
    body.destination_id,
    body.destination_type,
    body.company_id,
  )

  // Sem destino → fallback legado (api_connections)
  if (!dest) {
    const { data: row } = await admin
      .from("api_connections")
      .select("config, status")
      .eq("provider", "rocketchat")
      .maybeSingle()

    if (row?.config) {
      const cfg  = row.config as Record<string, string>
      const mode = cfg.mode ?? "rest"
      let success      = false
      let errorMessage = ""
      const logChannel = body.channel?.trim() || cfg.default_channel || ""

      try {
        if (mode === "webhook") {
          if (!cfg.webhook_url) throw new Error("webhook_url não configurado")
          const res = await fetch(cfg.webhook_url, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ alias: cfg.alias ?? "Jarvis", channel: logChannel, text: message.trim() }),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
        } else {
          if (!cfg.url || !cfg.user_id || !cfg.auth_token) throw new Error("Configuração REST incompleta")
          const ch = logChannel.startsWith("#") || logChannel.startsWith("@") ? logChannel : `#${logChannel}`
          const res = await fetch(`${cfg.url.replace(/\/$/, "")}/api/v1/chat.postMessage`, {
            method:  "POST",
            headers: { "Content-Type": "application/json", "X-Auth-Token": cfg.auth_token, "X-User-Id": cfg.user_id },
            body: JSON.stringify({ channel: ch, text: message.trim() }),
          })
          const j = await res.json() as { success?: boolean; error?: string }
          if (!res.ok || j.success === false) throw new Error(j.error ?? `HTTP ${res.status}`)
        }
        success = true
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : "Erro"
      }

      try {
        await admin.from("integration_logs").insert({
          provider:      "rocketchat",
          action:        "send_message",
          status:        success ? "success" : "error",
          user_id:       user.id,
          session_id:    body.session_id ?? null,
          payload:       { source: "legacy_api_connections", channel: logChannel, message_length: message.trim().length },
          response:      {},
          error_message: errorMessage || null,
        })
      } catch { /* silencioso */ }

      if (!success) return NextResponse.json({ error: errorMessage }, { status: 502 })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json(
      { error: "Nenhum destino Rocket.Chat configurado. Acesse Configurações > APIs > Destinos Rocket.Chat." },
      { status: 422 },
    )
  }

  // Enviar via destino resolvido
  let success      = false
  let errorMessage = ""
  const logChannel = body.channel?.trim() || dest.channel

  try {
    if (dest.mode === "webhook") {
      await sendWebhook(dest, message, body.channel)
    } else {
      await sendRest(dest, message, body.channel)
    }
    success = true
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Erro desconhecido"
  }

  // Log — nunca salvar webhook_url nem auth_token
  try {
    await admin.from("integration_logs").insert({
      provider:      "rocketchat",
      action:        "send_message",
      status:        success ? "success" : "error",
      user_id:       user.id,
      session_id:    body.session_id ?? null,
      payload:       {
        destination_id:     dest.id,
        destination_type:   dest.type,
        destination_source: source,
        mode:               dest.mode,
        channel:            logChannel,
        message_length:     message.trim().length,
        source_type:        body.source_type ?? null,
        source_id:          body.source_id   ?? null,
      },
      response:      {},
      error_message: errorMessage || null,
    })
  } catch { /* silencioso */ }

  void logActivity({
    userId:    user.id,
    eventType: "api",
    action:    success ? "rocketchat_message_sent" : "rocketchat_message_failed",
    detail:    `[${dest.type}] ${logChannel}`,
    metadata:  { destination_id: dest.id, destination_type: dest.type, mode: dest.mode, channel: logChannel, success, error: errorMessage || null },
  })

  if (!success) {
    return NextResponse.json(
      { error: errorMessage || "Falha ao enviar mensagem para o Rocket.Chat" },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, destination_id: dest.id, destination_type: dest.type })
}
