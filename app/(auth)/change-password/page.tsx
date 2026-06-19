"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase-browser"

export default function ChangePasswordPage() {
  const router  = useRouter()
  const [password, setPassword]   = useState("")
  const [confirm,  setConfirm]    = useState("")
  const [loading,  setLoading]    = useState(false)
  const [error,    setError]      = useState<string | null>(null)
  const [success,  setSuccess]    = useState(false)

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading || success) return
    setError(null)

    if (password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.")
      return
    }
    if (!/[a-zA-Z]/.test(password)) {
      setError("A senha deve conter pelo menos uma letra.")
      return
    }
    if (!/[0-9]/.test(password)) {
      setError("A senha deve conter pelo menos um número.")
      return
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.")
      return
    }

    setLoading(true)

    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ new_password: password, confirm_password: confirm }),
    })

    const json = await res.json() as { ok?: boolean; error?: string }

    if (!res.ok || !json.ok) {
      setError(json.error ?? "Erro ao alterar senha.")
      setLoading(false)
      return
    }

    // Atualiza a sessão para que o JWT reflita must_change_password = false
    const supabase = createClient()
    await supabase.auth.refreshSession()

    setSuccess(true)
    setTimeout(() => router.push("/chat"), 1500)
  }

  const inputCls   = "w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors"
  const inputStyle = {
    background: "var(--bg-tertiary)",
    border:     "1px solid var(--border-primary)",
    color:      "var(--text-primary)",
  }
  const focusHandlers = {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) =>
      (e.target.style.borderColor = "var(--color-mota-purple)"),
    onBlur: (e: React.FocusEvent<HTMLInputElement>) =>
      (e.target.style.borderColor = "var(--border-primary)"),
  }

  return (
    <div
      className="w-full max-w-sm rounded-2xl p-8 flex flex-col gap-6"
      style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-primary)" }}
    >
      {/* Logo */}
      <div className="flex flex-col items-center gap-2 mb-2">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-bold"
          style={{ background: "var(--color-mota-purple)", color: "#fff" }}
        >
          M
        </div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Defina sua senha
        </h1>
        <p className="text-sm text-center" style={{ color: "var(--text-secondary)" }}>
          Por segurança, crie uma senha pessoal para acessar o Jarvis.
        </p>
      </div>

      {!success && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              Nova senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              required
              minLength={8}
              autoComplete="new-password"
              disabled={loading}
              className={inputCls}
              style={inputStyle}
              {...focusHandlers}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              Confirmar senha
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repita a nova senha"
              required
              autoComplete="new-password"
              disabled={loading}
              className={inputCls}
              style={inputStyle}
              {...focusHandlers}
            />
          </div>

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Use letras e números. Mínimo 8 caracteres.
          </p>

          {error && (
            <p
              className="text-sm rounded-lg px-3 py-2"
              style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-60"
            style={{ background: "var(--color-mota-purple)", color: "#fff" }}
          >
            {loading ? "Salvando…" : "Definir senha e continuar"}
          </button>
        </form>
      )}

      {success && (
        <div
          className="text-sm rounded-lg px-4 py-3 text-center"
          style={{ background: "rgba(22,163,74,0.1)", color: "#4ade80" }}
        >
          Senha definida com sucesso! Redirecionando…
        </div>
      )}
    </div>
  )
}
