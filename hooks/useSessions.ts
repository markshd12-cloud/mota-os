"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase-browser"
import { formatRelativeTime } from "@/lib/utils"

// ─── UI type (shape que SessionList consome) ──────────────────────────────────

export interface UISession {
  id:           string
  title:        string
  agentName:    string
  agentColor:   string
  company:      string
  companyShort: string
  time:         string
  date:         "today" | "yesterday" | string
  status:       "active" | "done"
  starred:      boolean
  archived:     boolean
  messageCount: number
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

const COMPANY_NAME: Record<string, string> = {
  cppem:   "CPPEM Concursos",
  unicive:  "Unicive",
  colegio:  "Colégio CPPEM",
  everton:  "Everton Mota",
  grupo:    "Grupo Mota",
}

const COMPANY_SHORT: Record<string, string> = {
  cppem:   "CPPEM",
  unicive:  "Unicive",
  colegio:  "Colégio",
  everton:  "Everton",
  grupo:    "Grupo",
}

function toDateLabel(iso: string): "today" | "yesterday" | string {
  const diffDays = Math.floor(
    (Date.now() - new Date(iso).getTime()) / 86_400_000
  )
  if (diffDays === 0) return "today"
  if (diffDays === 1) return "yesterday"
  return iso.slice(0, 10)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): UISession {
  const agent      = row.agent as { short_name: string; color: string } | null
  const lastMsgAt  = row.last_message_at as string ?? row.created_at as string

  return {
    id:           row.id,
    title:        row.title ?? "Nova conversa",
    agentName:    agent?.short_name ?? "IA",
    agentColor:   agent?.color     ?? "#6366f1",
    company:      COMPANY_NAME[row.company_id  as string] ?? "Grupo Mota",
    companyShort: COMPANY_SHORT[row.company_id as string] ?? "Grupo",
    time:         formatRelativeTime(new Date(lastMsgAt)),
    date:         toDateLabel(lastMsgAt),
    status:       "done",
    starred:      row.pinned   ?? false,
    archived:     row.archived ?? false,
    messageCount: row.message_count ?? 0,
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSessions(companyId?: string) {
  const [sessions, setSessions] = useState<UISession[]>([])
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(async () => {
    if (companyId === undefined) {
      setSessions([])
      setLoading(false)
      return
    }

    setLoading(true)
    const supabase = createClient()
    const SESSION_COLS = "id, title, company_id, last_message_at, created_at, pinned, archived, message_count, deleted_at, agent:agents(short_name, color)"

    const { data, error } = await supabase
      .from("sessions")
      .select(SESSION_COLS)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("last_message_at", { ascending: false })
      .limit(200)

    if (error) {
      // deleted_at ainda não existe no banco (migration 15/16 não aplicada).
      // Sem console.warn no client — error.message do Supabase pode vazar
      // nomes de coluna ou constraints. O fallback abaixo trata o caso.
      const { data: fallback } = await supabase
        .from("sessions")
        .select(SESSION_COLS)
        .eq("company_id", companyId)
        .eq("archived", false)
        .order("last_message_at", { ascending: false })
        .limit(200)
      setSessions((fallback ?? []).map(mapRow))
    } else {
      setSessions((data ?? []).map(mapRow))
    }
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    load()

    if (companyId === undefined) return

    const supabase = createClient()
    const channel  = supabase
      .channel(`sessions-watch-${companyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sessions" },
        () => load()
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [load, companyId])

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const renameSession = useCallback(async (id: string, title: string): Promise<boolean> => {
    const t = title.trim()
    if (!t) return false
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: t } : s))
    const res = await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t }),
    })
    if (!res.ok) { await load(); return false }
    return true
  }, [load])

  const togglePinned = useCallback(async (id: string): Promise<boolean> => {
    let newPinned = false
    setSessions(prev => prev.map(s => {
      if (s.id !== id) return s
      newPinned = !s.starred
      return { ...s, starred: newPinned }
    }))
    const res = await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: newPinned }),
    })
    if (!res.ok) {
      setSessions(prev => prev.map(s => s.id === id ? { ...s, starred: !newPinned } : s))
      return false
    }
    return true
  }, [])

  const archiveSession = useCallback(async (id: string): Promise<boolean> => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, archived: true } : s))
    const res = await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    })
    if (!res.ok) {
      setSessions(prev => prev.map(s => s.id === id ? { ...s, archived: false } : s))
      return false
    }
    return true
  }, [])

  const unarchiveSession = useCallback(async (id: string): Promise<boolean> => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, archived: false } : s))
    const res = await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: false }),
    })
    if (!res.ok) {
      setSessions(prev => prev.map(s => s.id === id ? { ...s, archived: true } : s))
      return false
    }
    return true
  }, [])

  const deleteSession = useCallback(async (id: string): Promise<boolean> => {
    setSessions(prev => prev.filter(s => s.id !== id))
    const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" })
    if (!res.ok) { await load(); return false }
    return true
  }, [load])

  return {
    sessions,
    loading,
    refresh: load,
    renameSession,
    togglePinned,
    archiveSession,
    unarchiveSession,
    deleteSession,
  }
}
