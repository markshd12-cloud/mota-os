/**
 * Lembretes recorrentes do chat. SERVER-SIDE ONLY.
 *
 * - Detecção de intenção ("me lembre…" / "/lembrete …" e cancelamento).
 * - Cálculo de next_run_at com timezone (sem lib externa, via Intl).
 * - Prompt de extração estruturada (a IA devolve JSON com horário/recorrência/conteúdo).
 */

export type Recurrence = "daily" | "weekly" | "once"

export interface ReminderSpec {
  content:      string
  time_of_day:  string        // "HH:MM" (24h)
  recurrence:   Recurrence
  days_of_week: number[] | null // 0=domingo … 6=sábado (só para weekly)
}

// ─── Detecção de intenção ───────────────────────────────────────────────────────

// Comando explícito (no início da mensagem).
const CMD_RE = /^\s*\/(lembrete|lembrar)\b/i

// Frase de lembrete em qualquer posição (a hora pode vir antes: "em 7 min me lembre…").
const NL_REMINDER_RE =
  /(me\s+lembr|lembr[ae][\s-]+me|lembre\s+de|cria\w*\s+(um\s+)?lembrete|agend\w*\s+(um\s+)?lembrete)/i

// Indício de tempo — evita falso positivo em "isso me lembra de quando…".
const TIME_HINT_RE =
  /([àa]s?\s*\d{1,2}([:h]\d{0,2})?|\bem\s+\d+\s*(min|minuto|hora|\bh\b)|daqui\s+a\s+\d|todo[s]?\s+(o\s+dia|os\s+dias|dia)|amanh[ãa]|toda[s]?\s+(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)|\bhoje\b|\d{1,2}h\b)/i

const CANCEL_RE =
  /(parar?\s+de\s+(me\s+)?lembrar|cancel\w*\s+(o\s+)?lembrete|remov\w*\s+(o\s+)?lembrete|n[ãa]o\s+me\s+lembre\s+mais|desativ\w*\s+(o\s+)?lembrete)/i

export function isReminderCreate(text: string): boolean {
  const t = (text ?? "").trim()
  if (!t) return false
  // Cancelamento tem prioridade (evita "não me lembre mais" cair em create)
  if (CANCEL_RE.test(t)) return false
  if (CMD_RE.test(t)) return true
  // Linguagem natural exige uma frase de lembrete + um indício de tempo.
  return NL_REMINDER_RE.test(t) && TIME_HINT_RE.test(t)
}

export function isReminderCancel(text: string): boolean {
  return CANCEL_RE.test((text ?? "").trim())
}

// ─── Extração via IA (prompt) ───────────────────────────────────────────────────

export const REMINDER_EXTRACTION_SYSTEM =
  "Você extrai um lembrete de uma mensagem em português e devolve APENAS um JSON válido, " +
  "sem markdown, sem comentários. Formato exato:\n" +
  `{"content": string, "time_of_day": "HH:MM", "recurrence": "daily"|"weekly"|"once", "days_of_week": number[]|null}\n` +
  "Regras: time_of_day em 24h (ex: 14:35). 'todos os dias' => daily. " +
  "Dias específicos (ex: segundas) => weekly com days_of_week (0=domingo..6=sábado). " +
  "Sem repetição ('amanhã', 'hoje', um horário único) => once. days_of_week null exceto para weekly. " +
  "TEMPO RELATIVO ('em N minutos', 'daqui a N horas'): some N ao HORÁRIO ATUAL informado e " +
  "devolva o horário absoluto resultante (HH:MM), com recurrence 'once'. " +
  "content é só o texto a lembrar, sem o pedido de agendamento (sem 'me lembre', sem 'em 7 minutos'). " +
  "Se realmente não houver horário, use \"09:00\"."

export function buildExtractionUser(message: string): string {
  const now = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Recife", weekday: "long",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date())
  return `Horário atual (America/Recife): ${now}.\nMensagem: """${message.slice(0, 2000)}"""\nResponda só o JSON.`
}

/** Faz parse + validação do JSON devolvido pela IA. Retorna null se inválido. */
export function parseReminderSpec(raw: string): ReminderSpec | null {
  try {
    let jsonStr = raw.trim().replace(/^```json\s*|\s*```$/g, "").trim()
    // Robustez: se vier prosa em volta, extrai o primeiro objeto {...}.
    if (!jsonStr.startsWith("{")) {
      const m = jsonStr.match(/\{[\s\S]*\}/)
      if (m) jsonStr = m[0]
    }
    const o = JSON.parse(jsonStr) as Partial<ReminderSpec>
    const content = typeof o.content === "string" ? o.content.trim() : ""
    const time = typeof o.time_of_day === "string" ? o.time_of_day.trim() : ""
    const m = time.match(/^(\d{1,2}):(\d{2})$/)
    if (!content || !m) return null
    const hh = Number(m[1]), mm = Number(m[2])
    if (hh > 23 || mm > 59) return null
    const recurrence: Recurrence =
      o.recurrence === "weekly" || o.recurrence === "once" ? o.recurrence : "daily"
    const days = Array.isArray(o.days_of_week)
      ? o.days_of_week.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
      : null
    return {
      content,
      time_of_day: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
      recurrence,
      days_of_week: recurrence === "weekly" ? (days && days.length ? days : null) : null,
    }
  } catch {
    return null
  }
}

// ─── Agendamento com timezone ───────────────────────────────────────────────────

/** Minutos que a hora local do fuso está adiantada em relação ao UTC, no instante dado. */
function tzOffsetMinutes(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return (asUTC - date.getTime()) / 60000
}

/** Instante UTC para uma hora de parede (ano/mês/dia/h/min) em um fuso. */
function zonedWallclockToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo, d, h, mi, 0)
  const off = tzOffsetMinutes(new Date(guess), tz)
  return new Date(guess - off * 60000)
}

/** Data (ano/mês/dia/diaSemana) de um instante, já no fuso. */
function zonedYmd(date: Date, tz: string): { y: number; mo: number; d: number; dow: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { y: +p.year, mo: +p.month, d: +p.day, dow: dowMap[p.weekday] ?? 0 }
}

/**
 * Próximo instante UTC em que o lembrete deve disparar, > `from`.
 * Procura nos próximos 14 dias o primeiro dia válido (recorrência/dia da semana)
 * cuja hora local (time_of_day no fuso) seja futura.
 */
export function computeNextRunAt(
  spec: { time_of_day: string; recurrence: Recurrence; days_of_week: number[] | null; timezone: string },
  from: Date = new Date(),
): Date | null {
  const [hh, mm] = spec.time_of_day.split(":").map(Number)
  const base = zonedYmd(from, spec.timezone)

  for (let i = 0; i < 14; i++) {
    // dia-base + i, em UTC só para derivar a data de parede no fuso
    const probe = new Date(Date.UTC(base.y, base.mo - 1, base.d + i, 12, 0, 0))
    const { y, mo, d, dow } = zonedYmd(probe, spec.timezone)
    const candidate = zonedWallclockToUtc(y, mo - 1, d, hh, mm, spec.timezone)

    if (candidate.getTime() <= from.getTime()) continue
    if (spec.recurrence === "weekly" && spec.days_of_week && spec.days_of_week.length > 0
        && !spec.days_of_week.includes(dow)) continue

    return candidate
  }
  return null
}
