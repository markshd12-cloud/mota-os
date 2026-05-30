import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin } from "@/lib/company-scope"

export const dynamic = "force-dynamic"

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface RCDestRow {
  id:          string
  name:        string
  type:        string
  mode:        string
  webhook_url: string | null
  base_url:    string | null
  user_id:     string | null
  auth_token:  string | null
  channel:     string
  alias:       string | null
  avatar:      string | null
  status:      string
  is_default:  boolean
  company_id:  string | null
  created_by:  string | null
  created_at:  string
  updated_at:  string
  metadata:    Record<string, unknown>
}

function mask(row: RCDestRow) {
  const { webhook_url, auth_token, ...rest } = row
  return {
    ...rest,
    has_webhook_url: !!webhook_url,
    has_auth_token:  !!auth_token,
  }
}

const SELECT_COLS = "id,name,type,mode,webhook_url,base_url,user_id,auth_token,channel,alias,avatar,status,is_default,company_id,created_by,created_at,updated_at,metadata"

// ─── GET — detalhe de um destino ──────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("rocketchat_destinations")
    .select(SELECT_COLS)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error || !data) return NextResponse.json({ error: "Destino não encontrado" }, { status: 404 })

  return NextResponse.json({ destination: mask(data as RCDestRow) })
}

// ─── PATCH — atualizar destino ─────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  if (!await isGlobalAdmin(user.id)) {
    return NextResponse.json({ error: "Apenas administradores podem editar destinos" }, { status: 403 })
  }

  const admin = createAdminClient()

  // Buscar registro atual para preservar secrets se não forem alterados
  const { data: existing, error: fetchErr } = await admin
    .from("rocketchat_destinations")
    .select(SELECT_COLS)
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (fetchErr || !existing) return NextResponse.json({ error: "Destino não encontrado" }, { status: 404 })

  const cur = existing as RCDestRow

  const body = await req.json() as {
    name?:        string
    type?:        string
    mode?:        string
    webhook_url?: string | null
    base_url?:    string | null
    user_id?:     string | null
    auth_token?:  string | null
    channel?:     string
    alias?:       string | null
    avatar?:      string | null
    status?:      string
    is_default?:  boolean
    company_id?:  string | null
    metadata?:    Record<string, unknown>
  }

  // Regra de secrets: se vier vazio, nulo ou mascarado → manter o existente
  function resolveSecret(incoming: string | null | undefined, current: string | null): string | null {
    if (incoming === undefined) return current
    if (!incoming || incoming.startsWith("****")) return current
    return incoming.trim()
  }

  const newWebhookUrl = resolveSecret(body.webhook_url, cur.webhook_url)
  const newAuthToken  = resolveSecret(body.auth_token,  cur.auth_token)

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name        !== undefined) patch.name        = body.name.trim()
  if (body.type        !== undefined) patch.type        = body.type
  if (body.mode        !== undefined) patch.mode        = body.mode
  if (body.base_url    !== undefined) patch.base_url    = body.base_url?.trim() || null
  if (body.user_id     !== undefined) patch.user_id     = body.user_id?.trim()  || null
  if (body.channel     !== undefined) patch.channel     = body.channel.trim()
  if (body.alias       !== undefined) patch.alias       = body.alias?.trim()    || null
  if (body.avatar      !== undefined) patch.avatar      = body.avatar?.trim()   || null
  if (body.status      !== undefined) patch.status      = body.status
  if (body.is_default  !== undefined) patch.is_default  = body.is_default
  if (body.company_id  !== undefined) patch.company_id  = body.company_id ?? null
  if (body.metadata    !== undefined) patch.metadata    = body.metadata

  // Sempre aplicar o resultado do resolve (pode ser unchanged)
  patch.webhook_url = newWebhookUrl
  patch.auth_token  = newAuthToken

  // Determinar status baseado na presença de credenciais
  if (body.status === undefined) {
    const mode    = (patch.mode ?? cur.mode) as string
    const hasCred = mode === "webhook"
      ? !!newWebhookUrl
      : !!(patch.base_url ?? cur.base_url) && !!newAuthToken
    if (cur.status === "not_configured" && hasCred) {
      patch.status = "configured"
    }
  }

  // Se for marcado como default, desmarcar os outros do mesmo tipo
  if (body.is_default) {
    const targetType = (patch.type ?? cur.type) as string
    await admin
      .from("rocketchat_destinations")
      .update({ is_default: false })
      .eq("type", targetType)
      .neq("id", id)
      .is("deleted_at", null)
  }

  const { data, error } = await admin
    .from("rocketchat_destinations")
    .update(patch)
    .eq("id", id)
    .select(SELECT_COLS)
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json({ destination: mask(data as RCDestRow) })
}

// ─── DELETE — soft delete ──────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  if (!await isGlobalAdmin(user.id)) {
    return NextResponse.json({ error: "Apenas administradores podem excluir destinos" }, { status: 403 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from("rocketchat_destinations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json({ ok: true })
}
