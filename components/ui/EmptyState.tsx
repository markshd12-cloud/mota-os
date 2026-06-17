"use client"

import type { LucideIcon } from "lucide-react"
import { motion } from "framer-motion"

interface EmptyStateAction {
  label:   string
  onClick: () => void
  icon?:   LucideIcon
}

interface EmptyStateProps {
  icon:         LucideIcon
  title:        string
  description?: string
  action?:      EmptyStateAction
  className?:   string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  const ActionIcon = action?.icon

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={`flex flex-col items-center justify-center text-center px-6 py-12 gap-4 ${className ?? ""}`}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: "var(--bg-hover)" }}
      >
        <Icon size={28} style={{ color: "var(--text-muted)" }} strokeWidth={1.5} />
      </div>

      <div className="flex flex-col gap-1 max-w-sm">
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </p>
        {description && (
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {description}
          </p>
        )}
      </div>

      {action && (
        <button
          onClick={action.onClick}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-mota-600 hover:bg-mota-700 text-white"
        >
          {ActionIcon && <ActionIcon size={15} />}
          {action.label}
        </button>
      )}
    </motion.div>
  )
}
