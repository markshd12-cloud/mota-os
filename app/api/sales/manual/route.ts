import { NextRequest, NextResponse } from "next/server"
import { createClient }             from "@/lib/supabase-server"
import { createAdminClient }        from "@/lib/supabase-admin"
import { isGlobalAdmin }            from "@/lib/company-scope"
import { ALL_SLUGS }                from "@/lib/company-scope"
import { logActivity }              from "@/lib/activity-logger"
import { dbError as handleDbError } from "@/lib/api-error"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const adminUser = await isGlobalAdmin(user.id)
  if (!adminUser) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 })

  const VALID_SOURCES = ["manual", "guru", "conta_azul", "webhook"] as const
  const body = await req.json().catch(() => ({})) as {
    company_id?:         string
    source?:             string
    external_id?:        string
    product_name?:       string
    offer_name?:         string
    customer_name?:      string
    customer_email?:     string
    gross_amount?:       number
    net_amount?:         number
    payment_method?:     string
    payment_status?:     string
    transaction_status?: string
    sale_date?:          string
    installments?:       number
    utm_source?:         string
    utm_campaign?:       string
  }

  // "grupo" não pode receber vendas diretamente — é empresa-mãe consolidada
  const CHILD_SLUGS_ONLY = ALL_SLUGS.filter(s => s !== "grupo")
  if (!body.company_id || !(CHILD_SLUGS_ONLY as string[]).includes(body.company_id)) {
    return NextResponse.json(
      { error: `company_id inválido. Use um dos: ${CHILD_SLUGS_ONLY.join(", ")}` },
      { status: 400 },
    )
  }

  if (!body.product_name?.trim()) {
    return NextResponse.json({ error: "product_name é obrigatório" }, { status: 400 })
  }

  if (!body.gross_amount || body.gross_amount <= 0) {
    return NextResponse.json({ error: "gross_amount deve ser positivo" }, { status: 400 })
  }

  const source = (VALID_SOURCES as readonly string[]).includes(body.source ?? "")
    ? body.source as typeof VALID_SOURCES[number]
    : "manual"

  const externalId = body.external_id?.trim() || null

  const admin = createAdminClient()

  const record = {
    company_id:         body.company_id,
    source,
    external_id:        externalId,
    sale_date:          body.sale_date
      ? new Date(body.sale_date).toISOString()
      : new Date().toISOString(),
    customer_name:      body.customer_name ?? null,
    customer_email:     body.customer_email ?? null,
    product_id:         null,
    product_name:       body.product_name,
    offer_name:         body.offer_name ?? null,
    payment_method:     body.payment_method ?? null,
    payment_status:     body.payment_status ?? "paid",
    transaction_status: body.transaction_status ?? "approved",
    gross_amount:       body.gross_amount,
    net_amount:         body.net_amount ?? null,
    fee_amount:         null,
    refund_amount:      null,
    currency:           "BRL",
    installments:       body.installments ?? null,
    checkout_url:       null,
    utm_source:         body.utm_source ?? null,
    utm_medium:         null,
    utm_campaign:       body.utm_campaign ?? null,
    utm_content:        null,
    utm_term:           null,
    metadata:           { manual: true, created_by: user.id },
    updated_at:         new Date().toISOString(),
  }

  // Usar upsert quando external_id é fornecido (idempotente para testes repetidos)
  const { data, error } = externalId
    ? await admin
        .from("sales_transactions")
        .upsert(record, { onConflict: "source,external_id", ignoreDuplicates: false })
        .select("id")
        .maybeSingle()
    : await admin
        .from("sales_transactions")
        .insert(record)
        .select("id")
        .single()

  if (error) return handleDbError(error, "sales_transactions.upsert[manual]")

  void logActivity({
    userId:    user.id,
    eventType: "api",
    action:    "Venda manual inserida",
    detail:    `${body.product_name} — ${body.company_id} — R$ ${body.gross_amount}`,
    companyId: body.company_id,
    metadata:  { sale_id: data?.id, external_id: externalId },
  })

  return NextResponse.json({ ok: true, id: data?.id ?? null })
}
