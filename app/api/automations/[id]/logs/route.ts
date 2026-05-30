import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()

  const { data: automation } = await admin
    .from("automations")
    .select("id")
    .eq("id", id)
    .eq("created_by", user.id)
    .single()

  if (!automation) return NextResponse.json({ error: "Não encontrado" }, { status: 404 })

  const { data, error } = await admin
    .from("automation_runs")
    .select("id, status, output, error_message, started_at, finished_at")
    .eq("automation_id", id)
    .order("started_at", { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  return NextResponse.json(data)
}
