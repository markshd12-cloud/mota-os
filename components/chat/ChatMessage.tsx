"use client"

import { useState, useCallback } from "react"
import { motion } from "framer-motion"
import { Check, Copy, CheckSquare, Square, Zap, Rocket, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Message, MessageBlock, ChecklistBlock } from "@/lib/mocks/messages"
import { modelLabel } from "@/lib/ai/model-registry"
import { MarkdownContent } from "./MarkdownContent"

function extractMessageText(content: MessageBlock[]): string {
  return content
    .map((block) => {
      switch (block.kind) {
        case "text":      return block.content
        case "card":      return `*${block.title}*\n${block.rows.map((r) => `${r.label}: ${r.value}`).join("\n")}`
        case "checklist": return `${block.title ? `*${block.title}*\n` : ""}${block.items.map((i) => `- ${i.text}`).join("\n")}`
        case "tags":      return `${block.label}: ${block.items.join(", ")}`
        default:          return ""
      }
    })
    .filter(Boolean)
    .join("\n\n")
}

interface ChatMessageProps {
  message:           Message
  index:             number
  onSendToRocket?:   (text: string) => void
  onRegenerate?:     (messageId: string) => void
}

export function ChatMessage({ message, index, onSendToRocket, onRegenerate }: ChatMessageProps) {
  const isUser = message.role === "user"
  const [hovered, setHovered] = useState(false)
  const [copied,  setCopied]  = useState(false)

  const handleCopy = useCallback(() => {
    const text = extractMessageText(message.content)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }, [message.content])

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.03 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn("flex gap-3 w-full group", isUser ? "justify-end" : "justify-start")}
    >
      {/* AI avatar */}
      {!isUser && (
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 border"
          style={{
            background: message.agentColor ? `${message.agentColor}18` : "var(--bg-input)",
            borderColor: message.agentColor ? `${message.agentColor}30` : "var(--border-color)",
          }}
        >
          <Zap size={13} style={{ color: message.agentColor ?? "#16a34a" }} />
        </div>
      )}

      {/* Bubble */}
      <div className={cn("flex flex-col gap-2 max-w-[75%]", isUser && "items-end")}>
        {/* Agent label */}
        {!isUser && message.agentName && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="text-[11px] font-semibold"
              style={{ color: message.agentColor ?? "#16a34a" }}
            >
              {message.agentName}
            </span>
            {/* Slash command badge */}
            {message.slashCommand && (
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded-full font-semibold"
                style={{ background: "rgba(139,92,246,0.12)", color: "#a78bfa" }}
              >
                /{message.slashCommand}
                {message.slashAgentLabel && ` · ${message.slashAgentLabel}`}
              </span>
            )}
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {message.timestamp}
            </span>
          </div>
        )}

        {/* Blocks */}
        <div className={cn("flex flex-col gap-2", isUser && "items-end")}>
          {message.content.map((block, i) => (
            <MessageBlockRenderer
              key={i}
              block={block}
              isUser={isUser}
              agentColor={message.agentColor}
              onSendToRocket={onSendToRocket}
              fullMessage={message.content}
            />
          ))}
        </div>

        {/* Metadata do modelo — badge discreta */}
        {!isUser && (message.modelUsed || message.providerUsed) && (
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {message.routedByJarvis ? "Jarvis → " : ""}
              {message.modelUsed && message.providerUsed
                ? modelLabel(message.providerUsed, message.modelUsed)
                : (message.modelUsed ?? message.providerUsed)}
            </span>
          </div>
        )}

        {/* Ações do assistente — aparecem no hover */}
        {!isUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: hovered ? 1 : 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-1 mt-1 flex-wrap"
          >
            {/* Copiar */}
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition-colors hover:bg-[var(--bg-hover)]"
              style={{ color: copied ? "#16a34a" : "var(--text-muted)", borderColor: "var(--border-color)" }}
              title="Copiar resposta"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copiado!" : "Copiar"}
            </button>

            {/* Gerar novamente */}
            {onRegenerate && (
              <button
                onClick={() => onRegenerate(message.id)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border transition-colors hover:bg-[var(--bg-hover)]"
                style={{ color: "var(--text-muted)", borderColor: "var(--border-color)" }}
                title="Gerar novamente"
              >
                <RefreshCw size={11} />
                Gerar novamente
              </button>
            )}

            {/* Rocket.Chat */}
            {onSendToRocket && (
              <button
                onClick={() => onSendToRocket(extractMessageText(message.content))}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] border transition-colors hover:bg-orange-500/10 hover:border-orange-500/30"
                style={{ color: "var(--text-muted)", borderColor: "var(--border-color)" }}
                title="Enviar para Rocket.Chat"
              >
                <Rocket size={11} className="text-orange-500" />
                Rocket.Chat
              </button>
            )}
          </motion.div>
        )}

        {/* Timestamp for user */}
        {isUser && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {message.timestamp}
          </span>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="w-7 h-7 rounded-full bg-mota-600 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-white text-[11px] font-semibold">A</span>
        </div>
      )}
    </motion.div>
  )
}

function MessageBlockRenderer({
  block, isUser, agentColor, onSendToRocket, fullMessage,
}: {
  block:           MessageBlock
  isUser:          boolean
  agentColor?:     string
  onSendToRocket?: (text: string) => void
  fullMessage?:    MessageBlock[]
}) {
  switch (block.kind) {
    case "text":
      return (
        <div
          className={cn(
            "px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
            isUser
              ? "bg-mota-600 text-white rounded-tr-sm whitespace-pre-wrap"
              : "rounded-tl-sm"
          )}
          style={!isUser ? {
            background: "var(--bg-card)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-color)",
          } : {}}
        >
          {/* Usuário: texto puro. IA: markdown renderizado (tabelas, títulos, código...) */}
          {isUser ? block.content : <MarkdownContent content={block.content} />}
        </div>
      )

    case "card":
      return <CardBlock block={block} agentColor={agentColor} />

    case "checklist":
      return <ChecklistBlockRenderer block={block} />

    case "actions":
      return (
        <div className="flex flex-wrap gap-2">
          {block.items.map((btn, i) => {
            const isRocketBtn = btn.label.toLowerCase().includes("rocket.chat")
            return (
              <button
                key={i}
                onClick={() => {
                  if (isRocketBtn && onSendToRocket && fullMessage) {
                    onSendToRocket(extractMessageText(fullMessage))
                  }
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all",
                  btn.variant === "primary"
                    ? "bg-mota-600 hover:bg-mota-700 text-white"
                    : isRocketBtn
                      ? "border hover:bg-orange-500/10 hover:border-orange-500/30"
                      : "border hover:bg-[var(--bg-hover)]"
                )}
                style={btn.variant !== "primary" ? {
                  borderColor: isRocketBtn ? "rgb(249 115 22 / 0.3)" : "var(--border-color)",
                  color:       isRocketBtn ? "rgb(249 115 22)"        : "var(--text-secondary)",
                } : {}}
              >
                {isRocketBtn && <Rocket size={11} />}
                {btn.label}
              </button>
            )
          })}
        </div>
      )

    case "tags":
      return (
        <div
          className="rounded-xl px-4 py-3 border text-xs"
          style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
        >
          <p className="font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
            {block.label}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {block.items.map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 rounded-lg font-medium"
                style={{
                  background: agentColor ? `${agentColor}15` : "var(--bg-input)",
                  color: agentColor ?? "var(--text-secondary)",
                  border: `1px solid ${agentColor ? `${agentColor}25` : "var(--border-color)"}`,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )

    case "divider":
      return <hr style={{ borderColor: "var(--border-color)" }} className="my-1" />

    default:
      return null
  }
}

function CardBlock({ block, agentColor }: { block: Extract<MessageBlock, { kind: "card" }>; agentColor?: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    const text = block.rows.map((r) => `${r.label}: ${r.value}`).join("\n")
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div
      className="rounded-xl border overflow-hidden text-xs w-full"
      style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
    >
      {/* Card header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b"
        style={{
          borderColor: "var(--border-color)",
          background: agentColor ? `${agentColor}08` : undefined,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {block.title}
          </span>
          {block.badge && (
            <span
              className="px-1.5 py-0.5 rounded font-medium text-[10px]"
              style={{
                background: agentColor ? `${agentColor}18` : "var(--bg-input)",
                color: agentColor ?? "var(--text-secondary)",
              }}
            >
              {block.badge}
            </span>
          )}
        </div>
        <button onClick={copy} className="transition-colors" style={{ color: "var(--text-muted)" }}>
          {copied ? <Check size={12} className="text-mota-500" /> : <Copy size={12} />}
        </button>
      </div>

      {/* Rows */}
      <div className="divide-y" style={{ borderColor: "var(--border-color)" }}>
        {block.rows.map((row, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-3 px-4 py-2",
              row.highlight && "bg-mota-500/5"
            )}
          >
            <span className="w-36 shrink-0 font-medium" style={{ color: "var(--text-muted)" }}>
              {row.label}
            </span>
            <span
              className={cn(row.highlight && "font-semibold text-mota-500")}
              style={!row.highlight ? { color: "var(--text-primary)" } : {}}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChecklistBlockRenderer({ block }: { block: ChecklistBlock }) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(block.items.filter((i) => i.done).map((i) => i.id))
  )

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const total = block.items.length
  const done  = checked.size

  return (
    <div
      className="rounded-xl border overflow-hidden text-xs w-full"
      style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b"
        style={{ borderColor: "var(--border-color)" }}
      >
        <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
          {block.title ?? "Checklist"}
        </span>
        <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
          {done}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-0.5" style={{ background: "var(--bg-input)" }}>
        <motion.div
          animate={{ width: `${(done / total) * 100}%` }}
          className="h-full bg-mota-500"
          transition={{ duration: 0.3 }}
        />
      </div>

      <div className="divide-y" style={{ borderColor: "var(--border-color)" }}>
        {block.items.map((item) => {
          const isDone = checked.has(item.id)
          return (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              className="w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
            >
              {isDone ? (
                <CheckSquare size={14} className="text-mota-500 shrink-0 mt-0.5" />
              ) : (
                <Square size={14} className="shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }} />
              )}
              <span
                className={cn(
                  "leading-relaxed",
                  isDone && "line-through"
                )}
                style={{ color: isDone ? "var(--text-muted)" : "var(--text-primary)" }}
              >
                {item.text}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
