import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("automations")
    .select("*")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 })

  const body = await req.json() as {
    name: string
    description?: string
    workflow_id: string
    company_id?: string
    frequency?: string
    config?: Record<string, unknown>
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("automations")
    .insert({
      name:        body.name,
      description: body.description ?? "",
      workflow_id: body.workflow_id,
      company_id:  body.company_id  ?? "grupo",
      frequency:   body.frequency   ?? "manual",
      config:      body.config      ?? {},
      status:      "active",
      created_by:  user.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: "Erro interno no servidor" }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
