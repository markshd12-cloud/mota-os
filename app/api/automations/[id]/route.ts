import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as Record<string, unknown>
  const allowed = ["name", "description", "workflow_id", "company_id", "frequency", "status", "config"]
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("automations")
    .update(patch)
    .eq("id", id)
    .eq("created_by", user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  if (!data)  return NextResponse.json({ error: "Não encontrado" }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { error } = await admin
    .from("automations")
    .delete()
    .eq("id", id)
    .eq("created_by", user.id)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  return NextResponse.json({ ok: true })
}
