"use client"

import { motion, AnimatePresence } from "framer-motion"
import { Check, Loader2, Save, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

export type SaveStatus = "idle" | "saving" | "saved" | "error"

interface SaveButtonProps {
  status:    SaveStatus
  onClick:   () => void
  idleLabel?: string
  savedLabel?: string
  disabled?: boolean
  className?: string
}

export function SaveButton({
  status,
  onClick,
  idleLabel = "Salvar",
  savedLabel = "Salvo!",
  disabled,
  className,
}: SaveButtonProps) {
  const isBusy = status === "saving"

  return (
    <button
      onClick={onClick}
      disabled={disabled || isBusy}
      className={cn(
        "flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl font-semibold text-white transition-colors disabled:opacity-60",
        status === "saved" ? "bg-emerald-600" :
        status === "error" ? "bg-red-600" :
        "bg-mota-600 hover:bg-mota-700",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {status === "saving" && (
          <motion.span key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Loader2 size={13} className="animate-spin" />
          </motion.span>
        )}
        {status === "saved" && (
          <motion.span
            key="saved"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: [0.5, 1.25, 1], opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <Check size={13} />
          </motion.span>
        )}
        {status === "error" && (
          <motion.span key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <AlertCircle size={13} />
          </motion.span>
        )}
        {status === "idle" && (
          <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Save size={13} />
          </motion.span>
        )}
      </AnimatePresence>

      <span>
        {status === "saving" ? "Salvando…" :
         status === "saved"  ? savedLabel :
         status === "error"  ? "Erro" :
         idleLabel}
      </span>
    </button>
  )
}
