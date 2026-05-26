import { NextRequest, NextResponse } from "next/server"
import { createAdminClient }        from "@/lib/supabase-admin"
import { resolveCompanyFromSale }   from "@/lib/sales-mapping"
import { logActivity }              from "@/lib/activity-logger"
import {
  timingSafeStringCompare,
  verifyHmacSignature,
  readBoundedRawBody,
} from "@/lib/security"
import { rateLimit, getClientIp } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

const WEBHOOK_SECRET     = process.env.GURU_WEBHOOK_SECRET ?? process.env.JARVIS_WEBHOOK_SECRET ?? ""
const GURU_HMAC_SECRET   = process.env.GURU_HMAC_SECRET ?? ""

// ─── Parser defensivo para payload da Guru ────────────────────────────────────
// A Guru pode enviar payloads com estrutura variável entre webhooks de transação.
// Parser extrai o que conhece e salva o restante em metadata.

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function dateStr(v: unknown): string | null {
  if (!v) return null
  try { return new Date(v as string).toISOString() } catch { return null }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGuruPayload(raw: any) {
  // A Guru pode enviar dados na raiz ou aninhados em transaction / data
  const tx  = raw?.transaction ?? raw?.data ?? raw
  const sub  = raw?.subscription ?? null
  const cust = tx?.customer ?? raw?.customer ?? null
  const prod = tx?.product ?? raw?.product ?? null
  const offer = tx?.offer ?? raw?.offer ?? null
  const payment = tx?.payment ?? raw?.payment ?? null
  const utms = tx?.utm_params ?? raw?.utm_params ?? null

  const externalId =
    str(tx?.id) ?? str(tx?.transaction_id) ?? str(raw?.id) ?? str(raw?.transaction_id)

  const saleDate =
    dateStr(tx?.sale_date ?? tx?.created_at ?? raw?.created_at ?? raw?.sale_date)
    ?? new Date().toISOString()

  const grossAmount =
    num(tx?.charge_amount ?? tx?.gross_amount ?? tx?.amount ?? payment?.amount)
  const netAmount =
    num(tx?.net_amount ?? tx?.producer_value)
  const feeAmount =
    num(tx?.fee_amount ?? tx?.platform_fee)
  const refundAmount =
    num(tx?.refund_amount)

  const transactionStatus =
    str(tx?.status ?? raw?.status ?? raw?.event)

  const paymentStatus = str(payment?.status ?? tx?.payment_status)
  const paymentMethod = str(payment?.type ?? tx?.payment_method)

  const customerName  = str(cust?.name ?? tx?.customer_name)
  const customerEmail = str(cust?.email ?? tx?.customer_email)

  const productId   = str(prod?.id ?? tx?.product_id)
  const productName = str(prod?.name ?? tx?.product_name)
  const offerName   = str(offer?.name ?? tx?.offer_name)

  const checkoutUrl = str(tx?.checkout_url ?? raw?.checkout_url)
  const installments = typeof tx?.installments === "number" ? tx.installments
    : typeof payment?.installments === "number" ? payment.installments
    : null

  const utmSource   = str(utms?.utm_source ?? tx?.utm_source)
  const utmMedium   = str(utms?.utm_medium ?? tx?.utm_medium)
  const utmCampaign = str(utms?.utm_campaign ?? tx?.utm_campaign)
  const utmContent  = str(utms?.utm_content ?? tx?.utm_content)
  const utmTerm     = str(utms?.utm_term ?? tx?.utm_term)

  // Subscription info — salvo em metadata
  const subscriptionId    = str(sub?.id ?? tx?.subscription_id)
  const subscriptionStatus = str(sub?.status ?? tx?.subscription_status)

  return {
    externalId,
    saleDate,
    grossAmount,
    netAmount,
    feeAmount,
    refundAmount,
    transactionStatus,
    paymentStatus,
    paymentMethod,
    customerName,
    customerEmail,
    productId,
    productName,
    offerName,
    checkoutUrl,
    installments,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    metadata: {
      // raw_payload NÃO é salvo aqui — Guru envia dados de cartão, endereço
      // e outras PII em alguns webhooks. Para diagnosticar é melhor consultar
      // o painel da Guru direto. Aqui só guardamos o evento + ids.
      guru_event:          str(raw?.event ?? raw?.type),
      subscription_id:     subscriptionId,
      subscription_status: subscriptionStatus,
    },
  }
}

export async function POST(req: NextRequest) {
  // Rate limit por IP — antes de validar secret.
  const ip = getClientIp(req)
  const rl = rateLimit(`webhook-guru:${ip}`, { limit: 120, windowMs: 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.resetIn) } },
    )
  }

  // Fail-closed: precisa de algum mecanismo de autenticação configurado.
  if (!WEBHOOK_SECRET && !GURU_HMAC_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Limita body para evitar DoS.
  const bodyResult = await readBoundedRawBody(req)
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Payload muito grande" }, { status: 413 })
  }
  const rawBody = bodyResult.raw

  // Aceita assinatura HMAC OU secret no header. HMAC tem preferência.
  const hmacHeader = req.headers.get("x-hub-signature-256")
    ?? req.headers.get("x-guru-signature")
    ?? ""
  const headerSecret = req.headers.get("x-guru-webhook-secret")
    ?? req.headers.get("x-jarvis-webhook-secret")
    ?? ""

  let authorized = false
  if (GURU_HMAC_SECRET && hmacHeader) {
    authorized = verifyHmacSignature(rawBody, hmacHeader, GURU_HMAC_SECRET)
  }
  if (!authorized && WEBHOOK_SECRET) {
    authorized = timingSafeStringCompare(headerSecret, WEBHOOK_SECRET)
  }
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any
  try {
    raw = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 })
  }

  const parsed = parseGuruPayload(raw)

  // Resolver empresa
  const companyId = await resolveCompanyFromSale({
    source:       "guru",
    product_id:   parsed.productId,
    product_name: parsed.productName,
    offer_name:   parsed.offerName,
    utm_campaign: parsed.utmCampaign,
  })

  if (!companyId) {
    // Não rejeitar — pode não ter mapping ainda. Salvar em cppem como fallback? Não, melhor logar e retornar 422.
    return NextResponse.json(
      { error: "Empresa não identificada para esta transação Guru", parsed },
      { status: 422 },
    )
  }

  const admin = createAdminClient()

  const record = {
    company_id:         companyId,
    source:             "guru" as const,
    external_id:        parsed.externalId,
    sale_date:          parsed.saleDate,
    customer_name:      parsed.customerName,
    customer_email:     parsed.customerEmail,
    product_id:         parsed.productId,
    product_name:       parsed.productName,
    offer_name:         parsed.offerName,
    payment_method:     parsed.paymentMethod,
    payment_status:     parsed.paymentStatus,
    transaction_status: parsed.transactionStatus,
    gross_amount:       parsed.grossAmount,
    net_amount:         parsed.netAmount,
    fee_amount:         parsed.feeAmount,
    refund_amount:      parsed.refundAmount,
    currency:           "BRL",
    installments:       parsed.installments,
    checkout_url:       parsed.checkoutUrl,
    utm_source:         parsed.utmSource,
    utm_medium:         parsed.utmMedium,
    utm_campaign:       parsed.utmCampaign,
    utm_content:        parsed.utmContent,
    utm_term:           parsed.utmTerm,
    metadata:           parsed.metadata,
    updated_at:         new Date().toISOString(),
  }

  const { data, error } = await admin
    .from("sales_transactions")
    .upsert(record, {
      onConflict:       "source,external_id",
      ignoreDuplicates: false,
    })
    .select("id")
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  void logActivity({
    eventType: "api",
    action:    "Transação Guru recebida",
    detail:    `${parsed.productName ?? "—"} — ${companyId} (${parsed.transactionStatus ?? "—"})`,
    companyId,
    metadata:  {
      source:             "guru",
      external_id:        parsed.externalId,
      transaction_status: parsed.transactionStatus,
      gross_amount:       parsed.grossAmount,
    },
  })

  return NextResponse.json({
    ok:         true,
    id:         data?.id ?? null,
    company_id: companyId,
  })
}
