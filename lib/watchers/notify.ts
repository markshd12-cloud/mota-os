/**
 * Notificação de vigias. SERVER-SIDE ONLY.
 * Quando um vigia dispara, entrega o alerta no canal configurado:
 *   - 'dashboard' (padrão): nenhuma ação externa — o alerta já fica visível
 *     em last_result + watcher_logs (consumidos pela UII).
 *   - 'rocketchat': resolve um destino Rocket.Chat (tipo 'watcher') da empresa
 *     (ou global) e envia a mensagem.
 * Nunca lança — falhas viram { sent: false, error }.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchWithTimeout } from '@/lib/security'
import type { CheckResult } from './evaluate-watcher'

const SEND_TIMEOUT_MS = 10_000

type RCDest = {
  id:          string
  mode:        string
  webhook_url: string | null
  base_url:    string | null
  user_id:     string | null
  auth_token:  string | null
  channel:     string
  alias:       string | null
  avatar:      string | null
  type:        string
}

export type WatcherForNotify = {
  id:                   string
  name:                 string
  company_id:           string | null
  notification_channel?: string | null
  notification_config?:  Record<string, unknown> | null
}

export type NotifyResult = {
  sent:            boolean
  channel:         string
  destination_id?: string
  error?:          string
}

const DEST_COLS = 'id,mode,webhook_url,base_url,user_id,auth_token,channel,alias,avatar,type'

// Resolve destino tipo 'watcher': default da empresa → default global.
async function resolveWatcherDest(
  admin:     SupabaseClient,
  companyId: string | null,
): Promise<RCDest | null> {
  if (companyId) {
    const { data } = await admin
      .from('rocketchat_destinations')
      .select(DEST_COLS)
      .eq('type', 'watcher')
      .eq('is_default', true)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .neq('status', 'inactive')
      .limit(1)
      .maybeSingle()
    if (data) return data as RCDest
  }

  const { data } = await admin
    .from('rocketchat_destinations')
    .select(DEST_COLS)
    .eq('type', 'watcher')
    .eq('is_default', true)
    .is('company_id', null)
    .is('deleted_at', null)
    .neq('status', 'inactive')
    .limit(1)
    .maybeSingle()

  return (data as RCDest) ?? null
}

async function sendWebhook(dest: RCDest, message: string): Promise<void> {
  if (!dest.webhook_url) throw new Error('webhook_url não configurado neste destino')

  const body: Record<string, string> = {
    alias:   dest.alias ?? 'Jarvis',
    channel: dest.channel,
    text:    message.trim(),
  }
  if (dest.avatar) body.avatar = dest.avatar

  const res = await fetchWithTimeout(dest.webhook_url, {
    method:    'POST',
    headers:   { 'Content-Type': 'application/json' },
    body:      JSON.stringify(body),
    timeoutMs: SEND_TIMEOUT_MS,
  })

  if (!res.ok) {
    let errBody = ''
    try { errBody = await res.text() } catch { /* noop */ }
    throw new Error(`HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 200)}` : ''}`)
  }
}

async function sendRest(dest: RCDest, message: string): Promise<void> {
  if (!dest.base_url || !dest.user_id || !dest.auth_token) {
    throw new Error('base_url, user_id e auth_token são obrigatórios no modo REST')
  }

  const channel = dest.channel.startsWith('#') || dest.channel.startsWith('@')
    ? dest.channel
    : `#${dest.channel}`

  const res = await fetchWithTimeout(`${dest.base_url.replace(/\/$/, '')}/api/v1/chat.postMessage`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-Token': dest.auth_token,
      'X-User-Id':    dest.user_id,
    },
    body:      JSON.stringify({ channel, text: message.trim() }),
    timeoutMs: SEND_TIMEOUT_MS,
  })

  const json = await res.json() as { success?: boolean; error?: string }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${json.error ?? JSON.stringify(json)}`)
  if (json.success === false) throw new Error(json.error ?? 'Rocket.Chat retornou success: false')
}

const STATUS_EMOJI: Record<CheckResult['status'], string> = {
  alert:   '🔴',
  warning: '🟡',
  error:   '⚠️',
  ok:      '🟢',
}

function formatMessage(watcherName: string, check: CheckResult): string {
  const emoji = STATUS_EMOJI[check.status] ?? '🔔'
  return `${emoji} *Vigia: ${watcherName}*\n${check.message}`
}

/** Resolve o canal de notificação do vigia (config tem prioridade sobre coluna). */
export function resolveChannel(watcher: WatcherForNotify): string {
  const cfg = watcher.notification_config ?? {}
  if (typeof cfg.channel === 'string' && cfg.channel) return cfg.channel
  return watcher.notification_channel || 'dashboard'
}

/**
 * Envia uma mensagem ao destino Rocket.Chat padrão da empresa (ou global).
 * Reutiliza a resolução de destino e o envio (webhook/REST) dos vigias.
 * Nunca lança — devolve { sent, error }.
 */
export async function sendRocketChatMessage(
  admin:     SupabaseClient,
  companyId: string | null,
  message:   string,
): Promise<{ sent: boolean; destination_id?: string; error?: string }> {
  const dest = await resolveWatcherDest(admin, companyId)
  if (!dest) return { sent: false, error: 'Nenhum destino Rocket.Chat configurado.' }
  try {
    if (dest.mode === 'webhook') await sendWebhook(dest, message)
    else                         await sendRest(dest, message)
    return { sent: true, destination_id: dest.id }
  } catch (e) {
    return { sent: false, destination_id: dest.id, error: e instanceof Error ? e.message : 'Erro ao enviar' }
  }
}

export async function notifyWatcher(
  admin:   SupabaseClient,
  watcher: WatcherForNotify,
  check:   CheckResult,
): Promise<NotifyResult> {
  const channel = resolveChannel(watcher)

  // Dashboard: alerta já visível em last_result + logs. Sem envio externo.
  if (channel !== 'rocketchat') return { sent: false, channel }

  const dest = await resolveWatcherDest(admin, watcher.company_id)
  if (!dest) {
    return { sent: false, channel, error: 'Nenhum destino Rocket.Chat (tipo "Vigias") configurado.' }
  }

  const message = formatMessage(watcher.name, check)

  let error = ''
  try {
    if (dest.mode === 'webhook') await sendWebhook(dest, message)
    else                         await sendRest(dest, message)
  } catch (e) {
    error = e instanceof Error ? e.message : 'Erro ao enviar'
  }

  try {
    await admin.from('integration_logs').insert({
      provider:      'rocketchat',
      action:        'send_message',
      status:        error ? 'error' : 'success',
      company_id:    watcher.company_id,
      payload:       {
        source:         'watcher',
        watcher_id:     watcher.id,
        destination_id: dest.id,
        channel:        dest.channel,
        message_length: message.length,
      },
      response:      {},
      error_message: error || null,
    })
  } catch { /* silencioso */ }

  return error
    ? { sent: false, channel, destination_id: dest.id, error }
    : { sent: true,  channel, destination_id: dest.id }
}
