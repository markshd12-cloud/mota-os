"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { showError } from "@/lib/toast"
import { SessionList }       from "@/components/chat/SessionList"
import { ChatWindow }        from "@/components/chat/ChatWindow"
import { RightContextPanel } from "@/components/chat/RightContextPanel"
import { ErrorBoundary }     from "@/components/ui/ErrorBoundary"
import { useIsMobile }       from "@/hooks/useIsMobile"
import { AnimatePresence, motion } from "framer-motion"
import { useAgents, type AgentWithConfig } from "@/hooks/useAgents"
import type { Agent } from "@/lib/mocks/agents"
import { useSessions }  from "@/hooks/useSessions"
import { useMessages }  from "@/hooks/useMessages"
import { useCompany }   from "@/components/providers/CompanyProvider"
import type { Message } from "@/lib/mocks/messages"

// ─── Tipos dos eventos SSE ────────────────────────────────────────────────────

import type { AIMode } from "@/lib/ai/model-registry"

interface SSEDelta        { type: "delta";        text: string }
interface SSEDone         { type: "done";         session_id: string; message_id: string | null; model: string; provider: string; usage: { input_tokens: number; output_tokens: number }; error: string | null }
interface SSEError        { type: "error";        error: string }
interface SSEAgentRouted  { type: "agent_routed"; command: string; label: string }
type SSEEvent = SSEDelta | SSEDone | SSEError | SSEAgentRouted

function parseSSE(raw: string): SSEEvent | null {
  const line = raw.startsWith("data: ") ? raw.slice(6) : raw
  try { return JSON.parse(line) as SSEEvent } catch { return null }
}

export default function ChatPage() {
  const { agents: agentList, loading: agentsLoading, error: agentsError } = useAgents()
  const { currentCompany } = useCompany()
  const companyId = currentCompany?.slug

  const isMobile = useIsMobile()
  const [selectedAgent, setSelectedAgent]   = useState<AgentWithConfig | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [rightPanelOpen, setRightPanelOpen]   = useState(true)
  const [isTyping, setIsTyping]               = useState(false)
  const [sourcesVersion, setSourcesVersion]   = useState(0)
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false)

  // Em mobile o painel direito começa fechado (evita espremer o chat)
  useEffect(() => {
    if (isMobile) setRightPanelOpen(false)
  }, [isMobile])

  const { messages, setMessages } = useMessages(activeSessionId)
  const {
    sessions, loading: sessionsLoading, refresh: refreshSessions,
    renameSession, togglePinned, archiveSession, unarchiveSession, deleteSession,
  } = useSessions(companyId)

  // Limpa a sessão ativa ao trocar de empresa
  useEffect(() => {
    setActiveSessionId(null)
  }, [companyId])

  const abortRef = useRef<AbortController | null>(null)

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  // Não auto-seleciona agente em nova sessão.
  // Sincroniza apenas se o usuário JÁ tiver um agente selecionado (dados atualizados do banco)
  useEffect(() => {
    if (!agentsLoading && agentList.length > 0 && selectedAgent) {
      const updated = agentList.find((a) => a.shortName === selectedAgent.shortName)
      if (updated && updated.dbId !== selectedAgent.dbId) {
        setSelectedAgent(updated)
      }
    }
  }, [agentsLoading, agentList, selectedAgent])

  function selectSession(id: string) {
    setActiveSessionId(id)
    const session = sessions.find((s) => s.id === id)
    // SEMPRE define (ou limpa) o agente — sem agentName = sem agente ativo
    const agentName = session?.agentName || null
    const matched   = agentName ? agentList.find((a) => a.shortName === agentName) ?? null : null
    setSelectedAgent(matched)
    setMobileSessionsOpen(false)   // fecha o drawer em mobile
  }

  function newSession() {
    setActiveSessionId(null)
    setSelectedAgent(null)   // nova sessão começa sem agente pré-selecionado
    setMobileSessionsOpen(false)
  }

  async function handleArchive(id: string): Promise<boolean> {
    const ok = await archiveSession(id)
    if (ok && activeSessionId === id) setActiveSessionId(null)
    return ok
  }

  async function handleDelete(id: string): Promise<boolean> {
    const ok = await deleteSession(id)
    if (ok && activeSessionId === id) setActiveSessionId(null)
    return ok
  }

  // Re-enriquece o agente quando o seletor passa um Agent base
  function handleAgentChange(a: Agent) {
    const enriched = agentList.find((ag) => ag.id === a.id || ag.shortName === a.shortName)
    if (enriched) setSelectedAgent(enriched)
  }

  const handleSend = useCallback(async (
    text:          string,
    aiMode:        AIMode    = "jarvis",
    attachmentIds: string[]  = [],
  ) => {
    if (!text.trim() || isTyping) return

    // ── Mensagens otimistas ──────────────────────────────────────────────────
    const userMsg: Message = {
      id:        `u-${Date.now()}`,
      role:      "user",
      timestamp: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      content:   [{ kind: "text", content: text }],
    }
    const aiMsgId = `ai-${Date.now()}`
    const aiMsg: Message = {
      id:         aiMsgId,
      role:       "assistant",
      agentName:  selectedAgent?.shortName ?? "Jarvis",
      agentColor: selectedAgent?.color     ?? "#16a34a",
      aiMode,
      timestamp:  new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      content:    [{ kind: "text" as const, content: "" }],
    }

    setMessages((prev) => [...prev, userMsg, aiMsg])
    setIsTyping(true)

    // ── Histórico para a API ─────────────────────────────────────────────────
    const history = messages.map((m) => ({
      role:    m.role as "user" | "assistant",
      content: m.content
        .filter((b): b is { kind: "text"; content: string } => b.kind === "text")
        .map((b) => b.content)
        .join("\n"),
    }))
    history.push({ role: "user", content: text })

    abortRef.current = new AbortController()

    try {
      const res = await fetch("/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          messages:         history,
          session_id:       activeSessionId,
          agent_id:         selectedAgent?.dbId || null,
          user_message:     text,
          company_id:       companyId ?? "grupo",
          selected_ai_mode: aiMode,
          attachment_ids:   attachmentIds.length > 0 ? attachmentIds : undefined,
        }),
        signal: abortRef.current.signal,
      })

      if (!res.body) throw new Error("Resposta sem corpo")

      // ── Parser SSE ───────────────────────────────────────────────────────────
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer      = ""
      let pendingSid: string | null = null
      let accumulated = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split("\n\n")
        buffer = blocks.pop() ?? ""

        for (const block of blocks) {
          for (const line of block.split("\n")) {
            if (!line.startsWith("data: ")) continue

            const event = parseSSE(line)
            if (!event) continue

            if (event.type === "agent_routed") {
              // Atualiza a mensagem IA com o badge do slash agent
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, agentName: event.label, slashCommand: event.command, slashAgentLabel: event.label }
                    : m
                )
              )
            } else if (event.type === "delta") {
              accumulated += event.text
              const snap = accumulated
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: [{ kind: "text" as const, content: snap }] }
                    : m
                )
              )
            } else if (event.type === "done") {
              pendingSid = event.session_id
              // Atualiza a mensagem IA com o modelo/provider usado e o id real
              // do banco (necessário para habilitar o feedback 👍/👎)
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? {
                        ...m,
                        id:             event.message_id ?? m.id,
                        modelUsed:      event.model,
                        providerUsed:   event.provider,
                        routedByJarvis: aiMode === "jarvis",
                      }
                    : m
                )
              )
            } else if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: [{ kind: "text" as const, content: `⚠️ ${event.error}` }] }
                    : m
                )
              )
            }
          }
        }
      }

      if (pendingSid && pendingSid !== activeSessionId) {
        setActiveSessionId(pendingSid)
      }
      refreshSessions()

    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: [{ kind: "text" as const, content: "⚠️ Erro ao conectar com a IA. Tente novamente." }] }
              : m
          )
        )
        showError("Erro ao conectar com a IA. Verifique sua conexão e tente novamente.")
      }
    } finally {
      setIsTyping(false)
    }
  }, [activeSessionId, isTyping, selectedAgent, messages, refreshSessions, setMessages])

  const handleRegenerate = useCallback(async (assistantMessageId: string) => {
    if (!activeSessionId || isTyping) return
    try {
      const res  = await fetch("/api/chat/regenerate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ session_id: activeSessionId, assistant_message_id: assistantMessageId }),
      })
      if (!res.ok) return
      const ctx = await res.json() as {
        user_message: string; history: { role: "user" | "assistant"; content: string }[]
        session_id: string; agent_id: string | null; company_id: string
      }
      // Re-envia com o mesmo texto e contexto
      void handleSend(ctx.user_message, "jarvis", [])
    } catch { /* silent */ }
  }, [activeSessionId, isTyping, handleSend])

  // Enquanto agentes carregam ou em caso de erro
  if (agentsLoading && !selectedAgent) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm" style={{ color: agentsError ? "var(--color-error, #ef4444)" : "var(--text-muted)" }}>
          {agentsError ? `Erro ao carregar agentes: ${agentsError}` : "Carregando agentes..."}
        </p>
      </div>
    )
  }

  const sessionListNode = (
    <SessionList
      activeId={activeSessionId ?? ""}
      sessions={sessions}
      loading={sessionsLoading}
      onSelect={selectSession}
      onNewSession={newSession}
      onRename={renameSession}
      onTogglePinned={togglePinned}
      onArchive={handleArchive}
      onUnarchive={unarchiveSession}
      onDelete={handleDelete}
    />
  )

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sessões — inline no desktop, drawer no mobile */}
      {!isMobile && (
        <ErrorBoundary label="Sessões">
          {sessionListNode}
        </ErrorBoundary>
      )}

      {isMobile && (
        <>
          <AnimatePresence>
            {mobileSessionsOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setMobileSessionsOpen(false)}
                className="fixed inset-0 z-40 bg-black/50"
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {mobileSessionsOpen && (
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="fixed inset-y-0 left-0 z-50"
              >
                <ErrorBoundary label="Sessões">
                  {sessionListNode}
                </ErrorBoundary>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      <ErrorBoundary label="Chat">
        <ChatWindow
          sessionId={activeSessionId}
          sessionTitle={activeSession?.title}
          sessionCompany={activeSession?.company}
          companyId={companyId}
          messages={messages}
          isTyping={isTyping}
          selectedAgent={selectedAgent as Agent | null}
          rightPanelOpen={rightPanelOpen}
          onAgentChange={handleAgentChange}
          onSend={handleSend}
          onRegenerate={handleRegenerate}
          onToggleRightPanel={() => setRightPanelOpen((v) => !v)}
          onSourcesChanged={() => setSourcesVersion((v) => v + 1)}
          onToggleSessions={isMobile ? () => setMobileSessionsOpen(true) : undefined}
          agents={agentList as unknown as Agent[]}
        />
      </ErrorBoundary>

      <ErrorBoundary label="Painel lateral">
        <RightContextPanel
          open={rightPanelOpen}
          onClose={() => setRightPanelOpen(false)}
          agent={selectedAgent as Agent | null}
          sessionTitle={activeSession?.title ?? "Nova sessão"}
          sessionId={activeSessionId}
          companyId={companyId}
          sourcesVersion={sourcesVersion}
        />
      </ErrorBoundary>
    </div>
  )
}
