"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase-browser"
import type { Message } from "@/lib/mocks/messages"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any, agentColor?: string): Message {
  return {
    id:         row.id,
    role:       row.role as "user" | "assistant",
    agentName:  row.agent?.short_name ?? undefined,
    agentColor: row.agent?.color ?? agentColor ?? undefined,
    timestamp:  new Date(row.created_at as string).toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit",
    }),
    content: [{ kind: "text" as const, content: row.content as string }],
  }
}

export function useMessages(sessionId: string | null) {
  const [messages,  setMessages]  = useState<Message[]>([])
  const [loading,   setLoading]   = useState(false)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("messages")
      .select("id, session_id, role, content, created_at, agent:agents(short_name, color)")
      .eq("session_id", id)
      .order("created_at", { ascending: true })

    setMessages((data ?? []).map((r) => mapRow(r)))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!sessionId) { setMessages([]); return }
    load(sessionId)
  }, [sessionId, load])

  return { messages, loading, setMessages }
}
