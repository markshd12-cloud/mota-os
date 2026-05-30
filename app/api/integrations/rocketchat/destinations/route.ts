import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin, getAllowedCompanyIds } from "@/lib/company-scope"

export const dynamic = "force-dynamic"

// ─── Tipos ────────────────────────────────────────────────────────────────────

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

// Remove secrets — retorna apenas flags e campos não-sensíveis
function mask(row: RCDestRow) {
  const { webhook_url, auth_token, ...rest } = row
  return {
    ...rest,
    has_webhook_url: !!webhook_url,
    has_auth_token:  !!auth_token,
  }
}

// ─── GET — listar destinos ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin  = createAdminClient()
  const isAdmin = await isGlobalAdmin(user.id)

  let query = admin
    .from("rocketchat_destinations")
    .select("id,name,type,mode,webhook_url,base_url,user_id,auth_token,channel,alias,avatar,status,is_default,company_id,created_by,created_at,updated_at,metadata")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })

  if (!isAdmin) {
    // Usuários comuns: destinos globais + da(s) empresa(s) deles
    const allowed = await getAllowedCompanyIds(user.id)
    if (allowed.length > 0) {
      query = query.or(`company_id.is.null,company_id.in.(${allowed.join(",")})`)
    } else {
      query = query.is("company_id", null)
    }
  }

  // Filtros opcionais
  const { searchParams } = new URL(req.url)
  const typeParam = searchParams.get("type")
  if (typeParam) query = query.eq("type", typeParam)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json({ destinations: (data ?? []).map(mask) })
}

// ─── POST — criar destino ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  if (!await isGlobalAdmin(user.id)) {
    return NextResponse.json({ error: "Apenas administradores podem criar destinos" }, { status: 403 })
  }

  const body = await req.json() as {
    name:        string
    type:        string
    mode?:       string
    webhook_url?: string
    base_url?:   string
    user_id?:    string
    auth_token?: string
    channel:     string
    alias?:      string
    avatar?:     string
    is_default?: boolean
    company_id?: string | null
    metadata?:   Record<string, unknown>
  }

  if (!body.name?.trim())    return NextResponse.json({ error: "name é obrigatório" }, { status: 400 })
  if (!body.type?.trim())    return NextResponse.json({ error: "type é obrigatório" }, { status: 400 })
  if (!body.channel?.trim()) return NextResponse.json({ error: "channel é obrigatório" }, { status: 400 })

  const admin = createAdminClient()

  // Se for marcado como default, desmarcar os outros do mesmo tipo
  if (body.is_default) {
    await admin
      .from("rocketchat_destinations")
      .update({ is_default: false })
      .eq("type", body.type)
      .is("deleted_at", null)
  }

  const hasCredentials =
    (body.mode === "webhook" && !!body.webhook_url?.trim()) ||
    (body.mode !== "webhook" && !!body.base_url?.trim() && !!body.auth_token?.trim())

  const { data, error } = await admin
    .from("rocketchat_destinations")
    .insert({
      name:        body.name.trim(),
      type:        body.type,
      mode:        body.mode ?? "webhook",
      webhook_url: body.webhook_url?.trim() || null,
      base_url:    body.base_url?.trim()    || null,
      user_id:     body.user_id?.trim()     || null,
      auth_token:  body.auth_token?.trim()  || null,
      channel:     body.channel.trim(),
      alias:       body.alias?.trim()       || null,
      avatar:      body.avatar?.trim()      || null,
      status:      hasCredentials ? "configured" : "not_configured",
      is_default:  body.is_default ?? false,
      company_id:  body.company_id ?? null,
      created_by:  user.id,
      metadata:    body.metadata ?? {},
    })
    .select("id,name,type,mode,webhook_url,base_url,user_id,auth_token,channel,alias,avatar,status,is_default,company_id,created_by,created_at,updated_at,metadata")
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })

  return NextResponse.json({ destination: mask(data as RCDestRow) }, { status: 201 })
}
