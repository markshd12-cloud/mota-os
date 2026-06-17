"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Search, Plus, Star, Archive, MessageSquare,
  Pencil, Trash2, RotateCcw, Check, X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { AgentTag } from "@/components/ui/StatusBadge"
import type { UISession } from "@/hooks/useSessions"
import { showSuccess, showError } from "@/lib/toast"

type Tab = "ativas" | "favoritas" | "arquivadas"

interface SessionListProps {
  activeId:       string
  sessions:       UISession[]
  loading?:       boolean
  onSelect:       (id: string) => void
  onNewSession:   () => void
  onRename:       (id: string, title: string) => Promise<boolean>
  onTogglePinned: (id: string) => Promise<boolean>
  onArchive:      (id: string) => Promise<boolean>
  onUnarchive:    (id: string) => Promise<boolean>
  onDelete:       (id: string) => Promise<boolean>
}

export function SessionList({
  activeId, sessions, loading, onSelect, onNewSession,
  onRename, onTogglePinned, onArchive, onUnarchive, onDelete,
}: SessionListProps) {
  const [search,           setSearch]           = useState("")
  const [tab,              setTab]              = useState<Tab>("ativas")
  const [hoveredId,        setHoveredId]        = useState<string | null>(null)
  const [editingId,        setEditingId]        = useState<string | null>(null)
  const [confirmDeleteId,  setConfirmDeleteId]  = useState<string | null>(null)

  const tabFiltered = sessions.filter(s => {
    if (tab === "ativas")     return !s.archived
    if (tab === "favoritas")  return s.starred
    if (tab === "arquivadas") return s.archived
    return true
  })

  const filtered = tabFiltered.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    s.agentName.toLowerCase().includes(search.toLowerCase())
  )

  // Na tab "ativas", fixadas sobem para um grupo próprio no topo;
  // os demais grupos por data excluem as fixadas para não duplicar.
  const pinned    = tab === "ativas" ? filtered.filter(s => s.starred) : []
  const byDate    = tab === "ativas" ? filtered.filter(s => !s.starred) : filtered
  const today     = byDate.filter(s => s.date === "today")
  const yesterday = byDate.filter(s => s.date === "yesterday")
  const older     = byDate.filter(s => s.date !== "today" && s.date !== "yesterday")

  const tabCounts = {
    ativas:     sessions.filter(s => !s.archived).length,
    favoritas:  sessions.filter(s => s.starred).length,
    arquivadas: sessions.filter(s => s.archived).length,
  }

  async function handleRenameSubmit(id: string, title: string) {
    const ok = await onRename(id, title)
    if (ok) {
      setEditingId(null)
      showSuccess("Sessão renomeada")
    } else {
      showError("Falha ao renomear sessão")
    }
  }

  async function handleDeleteConfirm(id: string) {
    const ok = await onDelete(id)
    if (ok) {
      setConfirmDeleteId(null)
      showSuccess("Sessão excluída")
    } else {
      showError("Falha ao excluir sessão")
    }
  }

  return (
    <div
      className="flex flex-col h-full border-r shrink-0 w-72"
      style={{ borderColor: "var(--border-color)", background: "var(--bg-sidebar)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 h-14 border-b shrink-0"
        style={{ borderColor: "var(--border-color)" }}
      >
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Sessões
        </span>
        <button
          onClick={onNewSession}
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors bg-mota-600 hover:bg-mota-700 text-white"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1 shrink-0">
        {(["ativas", "favoritas", "arquivadas"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 py-1 rounded-lg text-[10px] font-medium transition-colors",
              tab === t
                ? "bg-mota-600/15 text-mota-500"
                : "hover:bg-[var(--bg-hover)]"
            )}
            style={{ color: tab === t ? undefined : "var(--text-muted)" }}
          >
            {t === "favoritas" && (
              <Star
                size={8}
                fill={tab === t ? "currentColor" : "none"}
                className="shrink-0"
              />
            )}
            <span className="capitalize">{t}</span>
            {tabCounts[t] > 0 && (
              <span
                className={cn(
                  "rounded-full px-1 text-[9px] leading-4",
                  tab === t ? "bg-mota-600/20" : "bg-[var(--bg-input)]"
                )}
              >
                {tabCounts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-3 py-2 shrink-0">
        <div
          className="flex items-center gap-2 rounded-lg px-3 h-8"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border-color)" }}
        >
          <Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            type="text"
            placeholder="Buscar sessões..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
      </div>

      {/* Sessions */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {pinned.length > 0 && (
          <SessionGroup
            label="Fixadas" sessions={pinned}
            activeId={activeId} hoveredId={hoveredId} editingId={editingId} confirmDeleteId={confirmDeleteId}
            onSelect={onSelect} onHover={setHoveredId}
            onStartEdit={setEditingId} onRenameSubmit={handleRenameSubmit} onRenameCancel={() => setEditingId(null)}
            onDeleteStart={setConfirmDeleteId} onDeleteConfirm={handleDeleteConfirm} onDeleteCancel={() => setConfirmDeleteId(null)}
            onTogglePinned={onTogglePinned} onArchive={onArchive} onUnarchive={onUnarchive}
          />
        )}
        {today.length > 0 && (
          <SessionGroup
            label="Hoje" sessions={today}
            activeId={activeId} hoveredId={hoveredId} editingId={editingId} confirmDeleteId={confirmDeleteId}
            onSelect={onSelect} onHover={setHoveredId}
            onStartEdit={setEditingId} onRenameSubmit={handleRenameSubmit} onRenameCancel={() => setEditingId(null)}
            onDeleteStart={setConfirmDeleteId} onDeleteConfirm={handleDeleteConfirm} onDeleteCancel={() => setConfirmDeleteId(null)}
            onTogglePinned={onTogglePinned} onArchive={onArchive} onUnarchive={onUnarchive}
          />
        )}
        {yesterday.length > 0 && (
          <SessionGroup
            label="Ontem" sessions={yesterday}
            activeId={activeId} hoveredId={hoveredId} editingId={editingId} confirmDeleteId={confirmDeleteId}
            onSelect={onSelect} onHover={setHoveredId}
            onStartEdit={setEditingId} onRenameSubmit={handleRenameSubmit} onRenameCancel={() => setEditingId(null)}
            onDeleteStart={setConfirmDeleteId} onDeleteConfirm={handleDeleteConfirm} onDeleteCancel={() => setConfirmDeleteId(null)}
            onTogglePinned={onTogglePinned} onArchive={onArchive} onUnarchive={onUnarchive}
          />
        )}
        {older.length > 0 && (
          <SessionGroup
            label="Mais antigo" sessions={older}
            activeId={activeId} hoveredId={hoveredId} editingId={editingId} confirmDeleteId={confirmDeleteId}
            onSelect={onSelect} onHover={setHoveredId}
            onStartEdit={setEditingId} onRenameSubmit={handleRenameSubmit} onRenameCancel={() => setEditingId(null)}
            onDeleteStart={setConfirmDeleteId} onDeleteConfirm={handleDeleteConfirm} onDeleteCancel={() => setConfirmDeleteId(null)}
            onTogglePinned={onTogglePinned} onArchive={onArchive} onUnarchive={onUnarchive}
          />
        )}

        {loading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <div className="w-4 h-4 rounded-full border-2 border-mota-500 border-t-transparent animate-spin" />
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Carregando...</p>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <MessageSquare size={20} style={{ color: "var(--text-muted)" }} />
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {sessions.length === 0 ? "Nenhuma sessão ainda" : "Nenhuma sessão encontrada"}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SessionGroup ─────────────────────────────────────────────────────────────

interface GroupProps {
  label:            string
  sessions:         UISession[]
  activeId:         string
  hoveredId:        string | null
  editingId:        string | null
  confirmDeleteId:  string | null
  onSelect:         (id: string) => void
  onHover:          (id: string | null) => void
  onStartEdit:      (id: string) => void
  onRenameSubmit:   (id: string, title: string) => void
  onRenameCancel:   () => void
  onDeleteStart:    (id: string) => void
  onDeleteConfirm:  (id: string) => void
  onDeleteCancel:   () => void
  onTogglePinned:   (id: string) => Promise<boolean>
  onArchive:        (id: string) => Promise<boolean>
  onUnarchive:      (id: string) => Promise<boolean>
}

function SessionGroup({ label, sessions, ...rest }: GroupProps) {
  return (
    <div className="mb-1">
      <p
        className="text-[10px] font-semibold uppercase tracking-wider px-3 py-2"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </p>
      <div className="space-y-0.5">
        <AnimatePresence initial={false}>
          {sessions.map((s) => (
            <SessionItem key={s.id} session={s} {...rest} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─── SessionItem ──────────────────────────────────────────────────────────────

type ItemProps = Omit<GroupProps, "label" | "sessions"> & { session: UISession }

function SessionItem({
  session: s,
  activeId, hoveredId, editingId, confirmDeleteId,
  onSelect, onHover,
  onStartEdit, onRenameSubmit, onRenameCancel,
  onDeleteStart, onDeleteConfirm, onDeleteCancel,
  onTogglePinned, onArchive, onUnarchive,
}: ItemProps) {
  const active           = s.id === activeId
  const hovered          = s.id === hoveredId
  const isEditing        = s.id === editingId
  const isConfirmDelete  = s.id === confirmDeleteId

  const [editValue, setEditValue] = useState(s.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) {
      setEditValue(s.title)
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [isEditing, s.title])

  function submitRename() {
    if (editValue.trim()) onRenameSubmit(s.id, editValue)
    else onRenameCancel()
  }

  return (
    <motion.div
      layout
      exit={{ opacity: 0, height: 0, marginBottom: 0, transition: { duration: 0.18 } }}
      onHoverStart={() => !isEditing && !isConfirmDelete && onHover(s.id)}
      onHoverEnd={() => onHover(null)}
      onClick={() => !isEditing && !isConfirmDelete && onSelect(s.id)}
      className={cn(
        "group flex items-start gap-2.5 px-3 py-2.5 rounded-xl transition-colors relative overflow-hidden",
        isEditing || isConfirmDelete ? "cursor-default" : "cursor-pointer",
        active
          ? "bg-mota-600/10 border border-mota-600/25"
          : "hover:bg-[var(--bg-hover)] border border-transparent",
        s.starred && !active && "border-l-2 border-l-[#facc15]/60",
      )}
    >
      {/* Status dot / estrela quando fixada */}
      <div className="mt-1 shrink-0">
        {s.starred ? (
          <Star size={9} fill="#facc15" style={{ color: "#facc15" }} />
        ) : (
          <span
            className="block w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--border-color)" }}
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter")  { e.preventDefault(); submitRename() }
              if (e.key === "Escape") onRenameCancel()
            }}
            onClick={e => e.stopPropagation()}
            className="w-full rounded px-2 py-0.5 text-xs outline-none"
            style={{
              background: "var(--bg-input)",
              border: "1px solid var(--border-color)",
              color: "var(--text-primary)",
            }}
          />
        ) : (
          <>
            <p
              className={cn("text-xs font-medium leading-snug line-clamp-2", active ? "text-mota-500" : "")}
              style={{ color: active ? undefined : "var(--text-primary)" }}
            >
              {s.title}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <AgentTag name={s.agentName} color={s.agentColor} />
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {s.companyShort}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Right column */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        {isEditing ? (
          /* Rename confirm/cancel */
          <div className="flex items-center gap-0.5 mt-0.5">
            <button
              onClick={e => { e.stopPropagation(); submitRename() }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-mota-600/20 transition-colors text-mota-500"
            >
              <Check size={10} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onRenameCancel() }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={10} />
            </button>
          </div>
        ) : isConfirmDelete ? (
          /* Delete confirm/cancel */
          <div className="flex items-center gap-0.5 mt-0.5">
            <span className="text-[9px] mr-0.5" style={{ color: "var(--text-muted)" }}>Excluir?</span>
            <button
              onClick={e => { e.stopPropagation(); onDeleteConfirm(s.id) }}
              className="w-5 h-5 flex items-center justify-center rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
            >
              <Check size={10} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDeleteCancel() }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={10} />
            </button>
          </div>
        ) : (
          /* Time + hover actions */
          <>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {s.time}
            </span>
            <AnimatePresence>
              {hovered ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.1 }}
                  className="flex items-center gap-0.5"
                >
                  <button
                    title="Renomear"
                    onClick={e => { e.stopPropagation(); onStartEdit(s.id) }}
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    title={s.starred ? "Desfavoritar" : "Favoritar"}
                    onClick={async e => {
                      e.stopPropagation()
                      const ok = await onTogglePinned(s.id)
                      if (!ok) showError("Falha ao atualizar favorito")
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors"
                    style={{ color: s.starred ? "#facc15" : "var(--text-muted)" }}
                  >
                    <Star size={10} fill={s.starred ? "#facc15" : "none"} />
                  </button>
                  {s.archived ? (
                    <button
                      title="Desarquivar"
                      onClick={async e => {
                        e.stopPropagation()
                        const ok = await onUnarchive(s.id)
                        if (ok) showSuccess("Sessão desarquivada")
                        else    showError("Falha ao desarquivar")
                      }}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <RotateCcw size={10} />
                    </button>
                  ) : (
                    <button
                      title="Arquivar"
                      onClick={async e => {
                        e.stopPropagation()
                        const ok = await onArchive(s.id)
                        if (ok) showSuccess("Sessão arquivada", {
                          label:   "Desfazer",
                          onClick: () => onUnarchive(s.id),
                        })
                        else showError("Falha ao arquivar")
                      }}
                      className="w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] transition-colors"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <Archive size={10} />
                    </button>
                  )}
                  <button
                    title="Excluir"
                    onClick={e => { e.stopPropagation(); onDeleteStart(s.id) }}
                    className="w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/10 transition-colors"
                    style={{ color: "#ef4444" }}
                  >
                    <Trash2 size={10} />
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.div>
  )
}
