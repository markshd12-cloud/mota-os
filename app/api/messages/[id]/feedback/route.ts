import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

// PATCH — registra feedback do usuário numa resposta do assistente.
// body: { feedback: 1 | -1 | null }  (null remove o feedback)
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as { feedback?: number | null }
  const value = body.feedback

  if (value !== 1 && value !== -1 && value !== null) {
    return NextResponse.json({ error: "feedback inválido (use 1, -1 ou null)" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from("messages")
    .update({ feedback: value })
    .eq("id", id)
    .eq("role", "assistant")   // feedback só em respostas do assistente

  if (error) {
    return NextResponse.json({ error: "Erro ao salvar feedback" }, { status: 500 })
  }

  return NextResponse.json({ ok: true, feedback: value })
}
