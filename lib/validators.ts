/**
 * Schemas Zod compartilhados para validação de entrada em rotas de API.
 * SERVER-SIDE ONLY — nunca importar em Client Components (não é problema
 * de segurança, é tamanho do bundle: zod tem ~50 KB minified).
 */

import { z } from "zod"

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Faz parse de body JSON com schema Zod. Retorna union — chamador trata erro
 * sem precisar try/catch. Não vaza detalhes internos no `error`.
 *
 * Caller pattern:
 *   const parsed = await parseBody(req, mySchema)
 *   if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
 *   const data = parsed.data // tipado
 *
 * Para usar com raw body já lido (ex.: webhooks que validam HMAC antes):
 *   const parsed = parseJson(rawBody, mySchema)
 */
export async function parseBody<T extends z.ZodTypeAny>(
  req:    Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; error: string }> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return { ok: false, error: "JSON inválido" }
  }
  return parseUnknown(raw, schema)
}

export function parseJson<T extends z.ZodTypeAny>(
  jsonString: string,
  schema:     T,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(jsonString)
  } catch {
    return { ok: false, error: "JSON inválido" }
  }
  return parseUnknown(raw, schema)
}

function parseUnknown<T extends z.ZodTypeAny>(
  raw:    unknown,
  schema: T,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const firstIssue = result.error.issues[0]
    const msg = firstIssue
      ? `${firstIssue.path.join(".") || "body"}: ${firstIssue.message}`
      : "Validação falhou"
    return { ok: false, error: msg }
  }
  return { ok: true, data: result.data as z.infer<T> }
}

// ─── Tipos comuns reutilizáveis ──────────────────────────────────────────────

export const uuidSchema = z.string().uuid("ID deve ser um UUID válido")

export const companySlugSchema = z.enum(["grupo", "cppem", "unicive", "colegio", "everton"])

export const trimmedString = (min: number, max: number, label = "texto") =>
  z.string()
    .trim()
    .min(min, `${label} deve ter pelo menos ${min} caractere${min === 1 ? "" : "s"}`)
    .max(max, `${label} excede ${max} caracteres`)

// ─── Schemas específicos ─────────────────────────────────────────────────────

// /api/tasks — POST/PATCH (whitelist + tipos)
export const taskCreateSchema = z.object({
  title:       trimmedString(1, 200, "title"),
  description: z.string().max(2000).optional(),
  project_id:  uuidSchema.optional(),
  assignee_id: uuidSchema.optional(),
  status:      z.enum(["todo", "doing", "done", "blocked"]).optional(),
  priority:    z.enum(["low", "medium", "high", "urgent"]).optional(),
  due_date:    z.string().date().optional(),
  tags:        z.array(z.string().max(50)).max(20).optional(),
  position:    z.number().int().min(0).max(1_000_000).optional(),
})

export const taskPatchSchema = taskCreateSchema.partial().extend({
  id: uuidSchema,
})

export const taskDeleteSchema = z.object({
  id:      uuidSchema,
  archive: z.boolean().optional(),
})

// /api/integrations/rocketchat/send
export const rocketchatSendSchema = z.object({
  message:          trimmedString(1, 4000, "message"),
  channel:          z.string().max(200).optional(),
  destination_id:   uuidSchema.optional(),
  destination_type: z.string().max(50).optional(),
  source_type:      z.string().max(50).optional(),
  source_id:        z.string().max(200).optional(),
  company_id:       companySlugSchema.optional(),
  session_id:       uuidSchema.optional(),
})

// /api/webhooks/sales — campos vêm do provider, mantemos tolerante
export const salesWebhookSchema = z.object({
  source:             z.string().max(50).optional(),
  external_id:        z.string().max(200).optional(),
  sale_date:          z.string().max(50).optional(),
  customer_name:      z.string().max(200).optional(),
  customer_email:     z.string().email().max(200).optional().or(z.literal("")),
  product_id:         z.string().max(200).optional(),
  product_name:       z.string().max(500).optional(),
  offer_name:         z.string().max(500).optional(),
  payment_method:     z.string().max(50).optional(),
  payment_status:     z.string().max(50).optional(),
  transaction_status: z.string().max(50).optional(),
  gross_amount:       z.union([z.number(), z.string()]).optional(),
  net_amount:         z.union([z.number(), z.string()]).optional(),
  fee_amount:         z.union([z.number(), z.string()]).optional(),
  refund_amount:      z.union([z.number(), z.string()]).optional(),
  currency:           z.string().max(10).optional(),
  installments:       z.number().int().min(1).max(60).optional(),
  checkout_url:       z.string().url().max(500).optional().or(z.literal("")),
  utm_source:         z.string().max(200).optional(),
  utm_medium:         z.string().max(200).optional(),
  utm_campaign:       z.string().max(200).optional(),
  utm_content:        z.string().max(200).optional(),
  utm_term:           z.string().max(200).optional(),
  company_id:         companySlugSchema.optional(),
}).passthrough() // Aceita campos extras (vai pra metadata)
