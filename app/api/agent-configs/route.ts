import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { logActivity }       from "@/lib/activity-logger"
import { isGlobalAdmin }     from "@/lib/company-scope"

export const dynamic = "force-dynamic"

const ALLOWED_PROVIDERS = ["anthropic", "openai", "gemini"] as const
type AllowedProvider = (typeof ALLOWED_PROVIDERS)[number]

// ─── GET — lista agentes com configurações ────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  const [{ data: agents, error }, { data: configs }] = await Promise.all([
    admin
      .from("agents")
      .select("id, name, color, status")
      .order("name"),
    admin
      .from("agent_model_configs")
      .select("agent_id, provider, model_id, system_prompt, temperature, max_tokens, updated_at"),
  ])

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  const cfgMap = new Map((configs ?? []).map((c) => [c.agent_id, c]))

  const result = (agents ?? []).map((agent) => {
    const cfg = cfgMap.get(agent.id)
    return {
      agent_id:      agent.id,
      agent_name:    agent.name,
      agent_color:   agent.color,
      provider:      cfg?.provider       ?? "anthropic",
      model_id:      cfg?.model_id       ?? "claude-sonnet-4-6",
      system_prompt: cfg?.system_prompt  ?? "",
      temperature:   cfg?.temperature    ?? 0.7,
      max_tokens:    cfg?.max_tokens     ?? 2048,
      status:        agent.status        as "active" | "paused",
      updated_at:    cfg?.updated_at     ?? null,
    }
  })

  return NextResponse.json(result)
}

// ─── PATCH — upsert configuração de um agente ─────────────────────────────────

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const adminUser = await isGlobalAdmin(user.id)
  if (!adminUser) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })

  const body = await req.json() as {
    agent_id?:      string
    provider?:      string
    model_id?:      string
    system_prompt?: string
    temperature?:   number
    max_tokens?:    number
    status?:        string
  }

  const { agent_id, provider, model_id } = body

  if (!agent_id?.trim()) {
    return NextResponse.json({ error: "agent_id obrigatório" }, { status: 400 })
  }
  if (!provider || !(ALLOWED_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json(
      { error: `provider inválido — use: ${ALLOWED_PROVIDERS.join(", ")}` },
      { status: 400 },
    )
  }
  if (!model_id?.trim()) {
    return NextResponse.json({ error: "model_id obrigatório" }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: agent, error: agentErr } = await admin
    .from("agents")
    .select("id, status")
    .eq("id", agent_id)
    .single()

  if (agentErr || !agent) {
    return NextResponse.json({ error: "Agente não encontrado" }, { status: 404 })
  }

  const newStatus = body.status === "active" || body.status === "paused" ? body.status : null

  const [cfgResult] = await Promise.all([
    admin
      .from("agent_model_configs")
      .upsert(
        {
          agent_id,
          provider:      provider as AllowedProvider,
          model_id:      model_id.trim(),
          system_prompt: body.system_prompt ?? "",
          temperature:   typeof body.temperature === "number" ? body.temperature : 0.7,
          max_tokens:    typeof body.max_tokens   === "number" ? body.max_tokens   : 2048,
          updated_at:    new Date().toISOString(),
        },
        { onConflict: "agent_id" },
      )
      .select("updated_at")
      .single(),

    ...(newStatus && newStatus !== agent.status
      ? [admin.from("agents").update({ status: newStatus }).eq("id", agent_id)]
      : []),
  ])

  if (cfgResult.error) {
    return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  }

  void logActivity({
    userId:    user.id,
    eventType: "settings",
    action:    "Configuração de modelo atualizada",
    detail:    `${provider} / ${model_id}`,
    metadata:  { agent_id, provider, model_id, status: newStatus ?? agent.status },
  })

  return NextResponse.json({ ok: true, updated_at: cfgResult.data?.updated_at })
}
