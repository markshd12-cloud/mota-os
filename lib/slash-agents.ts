/**
 * Slash agents — SERVER-SIDE types + helpers.
 * Nunca expor system_prompt ao cliente.
 */

export interface SlashAgentPublic {
  id:          string
  command:     string
  label:       string
  description: string
  icon:        string
  admin_only:  boolean
  sort_order:  number
}

export interface SlashAgentFull extends SlashAgentPublic {
  system_prompt: string
  model:         string
  provider:      string
}

/** Extrai /comando e query do texto digitado. */
export function parseSlashCommand(text: string): { command: string; query: string } | null {
  const match = text.match(/^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  return {
    command: match[1].toLowerCase(),
    query:   (match[2] ?? "").trim(),
  }
}
