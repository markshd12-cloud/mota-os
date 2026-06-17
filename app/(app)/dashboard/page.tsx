import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase-server"
import { isGlobalAdmin } from "@/lib/company-scope"
import DashboardView from "./DashboardView"

export const dynamic = "force-dynamic"

// Guarda server-side: o dashboard é exclusivo para admin global.
// A verificação roda ANTES de qualquer render, então um não-admin nunca
// recebe o HTML/dados do dashboard — é redirecionado direto para /chat,
// eliminando o "flash" de conteúdo que existia na verificação client-side.
export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")
  if (!(await isGlobalAdmin(user.id))) redirect("/chat")

  return <DashboardView />
}
