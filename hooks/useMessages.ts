"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase-browser"
import type { Message } from "@/lib/mocks/messages"
import { modelLabel } from "@/lib/ai/model-registry"

// blocks jsonb armazena metadados extras da mensagem (slash_command, ai_mode, etc.)
type MessageBlocks = {
  slashCommand?:    string
  slashAgentLabel?: string
  aiMode?:          string
  routedByJarvis?:  boolean
} | null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Message {
  const blocks = row.blocks as MessageBlocks

  return {
    id:         row.id,
    role:       row.role as "user" | "assistant",
    agentName:  row.agent?.short_name ?? undefined,
    agentColor: row.agent?.color      ?? undefined,
    timestamp:  new Date(row.created_at as string).toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit",
    }),
    content: [{ kind: "text" as const, content: row.content as string }],

    // ── Metadados de IA persistidos ────────────────────────────────────────
    modelUsed:       (row.model_used   as string | null)  ?? undefined,
    providerUsed:    (row.provider     as string | null)  ?? undefined,
    // label legível ex: "Claude Sonnet" em vez de "claude-sonnet-4-6"
    slashCommand:    blocks?.slashCommand    ?? undefined,
    slashAgentLabel: blocks?.slashAgentLabel ?? undefined,
    aiMode:          blocks?.aiMode          ?? undefined,
    routedByJarvis:  blocks?.routedByJarvis  ?? undefined,
    feedback:        (row.feedback as number | null) ?? null,
  }
}

// modelLabel é re-exported para uso em ChatMessage se necessário
export { modelLabel }

export function useMessages(sessionId: string | null) {
  const [messages,  setMessages]  = useState<Message[]>([])
  const [loading,   setLoading]   = useState(false)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    const supabase = createClient()
    const COLS_WITH_FEEDBACK = "id, session_id, role, content, created_at, model_used, provider, blocks, feedback, agent:agents(short_name, color)"
    const COLS_BASE          = "id, session_id, role, content, created_at, model_used, provider, blocks, agent:agents(short_name, color)"

    const primary = await supabase
      .from("messages")
      .select(COLS_WITH_FEEDBACK)
      .eq("session_id", id)
      .order("created_at", { ascending: true })

    // Fallback: coluna feedback ainda não existe (migration não aplicada)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: any[] | null = primary.data
    if (primary.error) {
      const fb = await supabase
        .from("messages")
        .select(COLS_BASE)
        .eq("session_id", id)
        .order("created_at", { ascending: true })
      rows = fb.data
    }

    setMessages((rows ?? []).map(mapRow))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!sessionId) { setMessages([]); return }
    void load(sessionId)
  }, [sessionId, load])

  return { messages, loading, setMessages }
}
