"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase-browser"

export default function ResetPasswordPage() {
  const router = useRouter()

  const [sessionReady, setSessionReady] = useState(false)
  const [initError,    setInitError]    = useState<string | null>(null)
  const [password,     setPassword]     = useState("")
  const [confirm,      setConfirm]      = useState("")
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [success,      setSuccess]      = useState(false)

  // O /auth/callback já trocou o code por uma sessão (server-side, PKCE).
  // Aqui apenas verificamos se a sessão de recovery está ativa.
  // Não chamamos exchangeCodeForSession no browser — o code_verifier está em cookie
  // (server-side) e não em localStorage (browser), portanto a troca client-side
  // sempre falharia com "code verifier not found".
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true)
      } else {
        setInitError("Link inválido ou expirado. Solicite um novo e-mail de recuperação.")
      }
    })
  }, [])

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading || success) return

    setError(null)

    if (password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.")
      return
    }
    if (password !== confirm) {
      setError("As senhas não coincidem.")
      return
    }

    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      const { error: updateError } = await supabase.auth.updateUser({ password })

      if (updateError) {
        setError(updateError.message)
        return
      }

      // Registra primeiro acesso se for convite (app_metadata.must_change_password=true).
      const isInvite = currentUser?.app_metadata?.must_change_password === true
      if (isInvite) {
        await fetch("/api/auth/first-access", {
          method: "POST",
          credentials: "same-origin",
        }).catch(() => {/* não bloqueia o fluxo */})
      }

      setSuccess(true)
      await supabase.auth.signOut()
      setTimeout(() => router.push("/login"), 1800)
    } catch {
      setError("Erro de conexão. Verifique sua internet e tente novamente.")
    } finally {
      setLoading(false)
    }
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
          Nova senha
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Defina uma nova senha para sua conta
        </p>
      </div>

      {/* Erro de inicialização (link inválido / expirado) */}
      {initError && (
        <div
          className="text-sm rounded-lg px-4 py-3 text-center space-y-2"
          style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}
        >
          <p>{initError}</p>
          <a href="/login" className="underline text-xs" style={{ color: "#f87171" }}>
            Voltar para o login
          </a>
        </div>
      )}

      {/* Aguardando verificação de sessão */}
      {!initError && !sessionReady && (
        <p className="text-sm text-center" style={{ color: "var(--text-secondary)" }}>
          Verificando sessão…
        </p>
      )}

      {/* Formulário de nova senha */}
      {sessionReady && !success && (
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
            {loading ? "Salvando…" : "Salvar nova senha"}
          </button>
        </form>
      )}

      {/* Sucesso */}
      {success && (
        <div
          className="text-sm rounded-lg px-4 py-3 text-center"
          style={{ background: "rgba(22,163,74,0.1)", color: "#4ade80" }}
        >
          Senha alterada com sucesso! Redirecionando…
        </div>
      )}
    </div>
  )
}
