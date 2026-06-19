/**
 * Ticker LOCAL de lembretes (substitui o pg_cron quando rodando em localhost).
 *
 * O pg_cron do Supabase hospedado não alcança o seu localhost — então, em dev,
 * este script roda na SUA máquina e chama /api/cron/reminders a cada minuto.
 *
 * Uso (com o `npm run dev` rodando em outra aba):
 *   node scripts/reminders-ticker.mjs            # porta 3000
 *   node scripts/reminders-ticker.mjs 3001       # outra porta
 *
 * Envia o CRON_SECRET automaticamente se ele estiver no .env.local.
 * Ctrl+C para parar.
 */
import { readFileSync } from "node:fs"

const env = {}
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
} catch { /* sem .env.local — segue sem secret */ }

const PORT   = process.argv[2] || process.env.PORT || "3000"
const SECRET = env.CRON_SECRET
const url    = `http://localhost:${PORT}/api/cron/reminders` + (SECRET ? `?secret=${encodeURIComponent(SECRET)}` : "")

async function tick() {
  const ts = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Recife" })
  try {
    const res  = await fetch(url, { method: "POST" })
    const json = await res.json().catch(() => ({}))
    const fired = json?.fired
    const tag = res.ok ? (fired ? `🔔 ${fired} disparado(s)` : "ok") : `HTTP ${res.status}`
    console.log(`[${ts}] ${tag} ${JSON.stringify(json)}`)
  } catch (e) {
    console.log(`[${ts}] erro: ${e.message} — o 'npm run dev' está rodando na porta ${PORT}?`)
  }
}

console.log(`[ticker] chamando ${url} a cada 60s. Ctrl+C para parar.\n`)
tick()
setInterval(tick, 60_000)
