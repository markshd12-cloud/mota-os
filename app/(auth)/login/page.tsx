"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase-browser"  // usado pelo magic link

type Mode = "login" | "forgot" | "magic"

export default function LoginPage() {
  const router = useRouter()

  const [mode,     setMode]     = useState<Mode>("login")
  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [sent,     setSent]     = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setSent(false)
  }

  // ─── Login com senha ─────────────────────────────────────────────────────────

  async function handleLogin(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)

    const res = await fetch("/api/auth/email-login", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password }),
    })

    if (!res.ok) {
      const data = await res.json() as { error?: string }
      setError(data.error ?? "Erro ao entrar. Tente novamente.")
      setLoading(false)
      return
    }

    router.push("/dashboard")
    router.refresh()
  }

  // ─── Recuperação de senha ────────────────────────────────────────────────────

  async function handleForgotPassword(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)

    const res = await fetch("/api/auth/email-reset", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      }),
    })

    setLoading(false)
    if (!res.ok) {
      const data = await res.json() as { error?: string }
      setError(data.error ?? "Erro ao enviar. Tente novamente.")
      return
    }
    setSent(true)
  }

  // ─── Magic link ──────────────────────────────────────────────────────────────

  async function handleMagicLink(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  // ─── Shared styles ───────────────────────────────────────────────────────────

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

  const titleMap: Record<Mode, string> = {
    login:  "Jarvis",
    forgot: "Recuperar senha",
    magic:  "Link mágico",
  }
  const subtitleMap: Record<Mode, string> = {
    login:  "Sistema Operacional de IA",
    forgot: "Enviaremos um link de recuperação",
    magic:  "Acesse sem precisar de senha",
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
          {titleMap[mode]}
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {subtitleMap[mode]}
        </p>
      </div>

      {/* ─── Login ─── */}
      {mode === "login" && (
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              autoComplete="email"
              className={inputCls}
              style={inputStyle}
              {...focusHandlers}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                Senha
              </label>
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="text-xs hover:underline"
                style={{ color: "var(--color-mota-purple)" }}
              >
                Esqueceu?
              </button>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className={inputCls}
              style={inputStyle}
              {...focusHandlers}
            />
          </div>

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
            {loading ? "Entrando…" : "Entrar"}
          </button>

          <button
            type="button"
            onClick={() => switchMode("magic")}
            className="text-sm text-center hover:underline"
            style={{ color: "var(--text-secondary)" }}
          >
            Entrar com link mágico
          </button>
        </form>
      )}

      {/* ─── Recuperar senha ─── */}
      {mode === "forgot" && !sent && (
        <form onSubmit={handleForgotPassword} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              autoComplete="email"
              className={inputCls}
              style={inputStyle}
              {...focusHandlers}
            />
          </div>

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
            {loading ? "Enviando…" : "Enviar link de recuperação"}
          </button>

          <button
            type="button"
            onClick={() => switchMode("login")}
            className="text-sm text-center hover:underline"
            style={{ color: "var(--text-secondary)" }}
          >
            Voltar para o login
          </button>
        </form>
      )}

      {/* ─── Recuperar senha — confirmação ─── */}
      {mode === "forgot" && sent && (
        <div className="flex flex-col gap-4">
          <div
            className="text-sm rounded-lg px-4 py-3 text-center"
            style={{ background: "rgba(22,163,74,0.1)", color: "#4ade80" }}
          >
            E-mail enviado! Verifique sua caixa de entrada e clique no link de recuperação.
          </div>
          <button
            type="button"
            onClick={() => switchMode("login")}
            className="text-sm text-center hover:underline"
            style={{ color: "var(--text-secondary)" }}
          >
            Voltar para o login
          </button>
        </div>
      )}

      {/* ─── Magic link ─── */}
      {mode === "magic" && !sent && (
        <form onSubmit={handleMagicLink} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              autoComplete="email"
              className={inputCls}
              style={inputStyle}
              {...focusHandlers}
            />
          </div>

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
            {loading ? "Enviando…" : "Enviar link mágico"}
          </button>

          <button
            type="button"
            onClick={() => switchMode("login")}
            className="text-sm text-center hover:underline"
            style={{ color: "var(--text-secondary)" }}
          >
            Voltar para o login
          </button>
        </form>
      )}

      {/* ─── Magic link — confirmação ─── */}
      {mode === "magic" && sent && (
        <div className="flex flex-col gap-4">
          <div
            className="text-sm rounded-lg px-4 py-3 text-center"
            style={{ background: "rgba(22,163,74,0.1)", color: "#4ade80" }}
          >
            Link enviado! Verifique seu e-mail e clique no link para entrar.
          </div>
          <button
            type="button"
            onClick={() => switchMode("login")}
            className="text-sm text-center hover:underline"
            style={{ color: "var(--text-secondary)" }}
          >
            Voltar para o login
          </button>
        </div>
      )}
    </div>
  )
}
