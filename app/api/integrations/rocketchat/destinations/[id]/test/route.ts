import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { isGlobalAdmin }     from "@/lib/company-scope"

export const dynamic = "force-dynamic"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  if (!await isGlobalAdmin(user.id)) {
    return NextResponse.json({ error: "Apenas administradores podem testar destinos" }, { status: 403 })
  }

  const admin = createAdminClient()

  // Buscar destino — incluindo webhook_url e auth_token (server-side apenas)
  const { data: dest, error: fetchErr } = await admin
    .from("rocketchat_destinations")
    .select("id,name,type,mode,webhook_url,base_url,user_id,auth_token,channel,alias,avatar,status,company_id")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (fetchErr || !dest) {
    return NextResponse.json({ error: "Destino não encontrado" }, { status: 404 })
  }

  const mode       = (dest.mode       as string) ?? "webhook"
  const channel    = (dest.channel    as string)
  const alias      = (dest.alias      as string | null) ?? "Jarvis"
  const avatar     = (dest.avatar     as string | null) ?? null
  const name       = (dest.name       as string)
  const webhookUrl = (dest.webhook_url as string | null)
  const baseUrl    = (dest.base_url   as string | null)
  const rcUserId   = (dest.user_id    as string | null)
  const authToken  = (dest.auth_token as string | null)

  const testMessage = `✅ Teste de conexão do destino "${name}" no Jarvis.`

  let testOk         = false
  let errMsg         = ""
  let rcHttpStatus   = 0
  let rcResponseText = ""

  if (mode === "webhook") {
    if (!webhookUrl) {
      return NextResponse.json(
        { error: "webhook_url não configurado para este destino" },
        { status: 422 },
      )
    }

    try {
      const body: Record<string, unknown> = {
        alias,
        channel,
        text: testMessage,
      }
      // Só inclui avatar se tiver valor
      if (avatar) body.avatar = avatar

      const res = await fetch(webhookUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })

      rcHttpStatus = res.status

      try {
        rcResponseText = await res.text()
      } catch { /* noop */ }

      if (!res.ok) {
        throw new Error(
          `HTTP ${res.status}${rcResponseText ? `: ${rcResponseText.slice(0, 300)}` : ""}`,
        )
      }

      testOk = true
    } catch (err) {
      errMsg = err instanceof Error ? err.message : "Erro desconhecido"
    }

  } else {
    // Modo REST — testa autenticidade via GET /api/v1/me
    if (!baseUrl || !rcUserId || !authToken) {
      return NextResponse.json(
        { error: "base_url, user_id e auth_token são obrigatórios no modo REST" },
        { status: 422 },
      )
    }

    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/me`, {
        headers: {
          "X-Auth-Token": authToken,
          "X-User-Id":    rcUserId,
        },
      })

      rcHttpStatus = res.status

      try {
        rcResponseText = await res.text()
      } catch { /* noop */ }

      if (!res.ok) {
        const preview = rcResponseText.slice(0, 200)
        throw new Error(`HTTP ${res.status}${preview ? `: ${preview}` : ""}`)
      }

      testOk = true
    } catch (err) {
      errMsg = err instanceof Error ? err.message : "Erro desconhecido"
    }
  }

  const now       = new Date().toISOString()
  const newStatus = testOk ? "connected" : "error"

  // Atualizar destino com resultado do teste (sem tocar em webhook_url/auth_token)
  await admin
    .from("rocketchat_destinations")
    .update({
      status:        newStatus,
      error_message: testOk ? null : errMsg,
      last_tested_at: now,
      updated_at:    now,
    })
    .eq("id", id)

  // Gravar em integration_logs — nunca salvar webhook_url, auth_token ou token
  try {
    await admin.from("integration_logs").insert({
      provider:      "rocketchat",
      action:        "test_destination",
      status:        testOk ? "success" : "error",
      user_id:       user.id,
      company_id:    (dest.company_id as string | null) ?? null,
      session_id:    null,
      payload: {
        destination_id:   dest.id   as string,
        destination_type: dest.type as string,
        channel,
        request_summary: {
          mode,
          channel,
          has_avatar:     !!avatar,
          message_length: testMessage.length,
        },
      },
      response: {
        response_summary: {
          http_status:      rcHttpStatus  || null,
          response_preview: rcResponseText.slice(0, 300) || null,
        },
      },
      error_message: testOk ? null : errMsg,
    })
  } catch { /* log silencioso — nunca quebrar o fluxo por isso */ }

  if (!testOk) {
    return NextResponse.json(
      { ok: false, status: newStatus, error: errMsg },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, status: newStatus })
}
