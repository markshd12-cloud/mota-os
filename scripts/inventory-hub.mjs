/**
 * Inventário das entidades do HUB antes da consolidação Skill + Automação.
 * Conta linhas por tabela (e por status quando útil) usando a service role key.
 * Uso: node scripts/inventory-hub.mjs
 */
import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

// Carrega .env.local sem dependência externa
const env = {}
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local")
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

const tables = [
  "agents", "agent_model_configs", "agent_files",
  "skills", "workflows", "workflow_runs",
  "automations", "automation_runs",
  "schedules", "watchers", "watcher_logs",
  "knowledge_sources", "knowledge_chunks",
]

async function count(table, filter) {
  let q = db.from(table).select("*", { count: "exact", head: true })
  if (filter) q = filter(q)
  const { count, error } = await q
  if (error) return `erro: ${error.message}`
  return count ?? 0
}

console.log("\n=== INVENTÁRIO HUB ===\n")
for (const t of tables) {
  const total = await count(t)
  let extra = ""
  if (typeof total === "number" && total > 0) {
    const active = await count(t, (q) => q.eq("status", "active")).catch(() => "—")
    if (typeof active === "number") extra = `  (active: ${active})`
  }
  console.log(`${t.padEnd(22)} ${String(total).padStart(6)}${extra}`)
}
console.log("")
