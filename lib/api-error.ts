/**
 * Helpers para respostas de erro nas API routes.
 * Nunca expõe mensagens internas do banco ou stack traces ao cliente.
 * SERVER-SIDE ONLY.
 */

import { NextResponse } from "next/server"

// Mensagens genéricas mapeadas por status — o detalhe vai para o console, não para o cliente
const GENERIC: Record<number, string> = {
  400: "Requisição inválida.",
  401: "Não autorizado.",
  403: "Sem permissão para esta operação.",
  404: "Recurso não encontrado.",
  409: "Conflito — registro já existe.",
  413: "Payload muito grande.",
  415: "Tipo de arquivo não suportado.",
  422: "Dados inválidos.",
  429: "Limite de requisições atingido.",
  500: "Erro interno. Tente novamente.",
  502: "Serviço externo indisponível.",
}

/**
 * Retorna NextResponse de erro sem vazar detalhes internos.
 * Loga o erro original no servidor para diagnóstico.
 */
export function apiError(
  status: number,
  internalError?: unknown,
  publicMessage?: string,
): NextResponse {
  if (internalError) {
    const detail = internalError instanceof Error
      ? internalError.message
      : String(internalError)
    console.error(`[api-error] ${status}:`, detail)
  }

  const message = publicMessage ?? GENERIC[status] ?? "Erro inesperado."
  return NextResponse.json({ error: message }, { status })
}

/**
 * Variante para erros de banco Supabase:
 * traduz códigos PostgreSQL conhecidos em mensagens amigáveis.
 */
export function dbError(
  err: { message?: string; code?: string } | null,
  context?: string,
): NextResponse {
  if (err) {
    console.error(`[db-error]${context ? ` [${context}]` : ""}:`, err.code, err.message)
  }

  // Viola unique constraint → 409
  if (err?.code === "23505") return apiError(409)
  // Viola FK constraint → 422
  if (err?.code === "23503") return apiError(422, undefined, "Referência inválida.")

  return apiError(500)
}