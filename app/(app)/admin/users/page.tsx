"use client"

import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Users,
  Search,
  Loader2,
  AlertCircle,
  RefreshCw,
  Pencil,
  X,
  Check,
  Trash2,
  Shield,
  ShieldOff,
  Building2,
  Lock,
  UserPlus,
  Mail,
} from "lucide-react"
import { PageHeader } from "@/components/ui/PageHeader"
import { EmptyState } from "@/components/ui/EmptyState"
import { useCompany } from "@/components/providers/CompanyProvider"
import { createClient } from "@/lib/supabase-browser"
import { showSuccess, showError } from "@/lib/toast"

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfile {
  id:                  string
  name:                string | null
  email:               string
  role:                string
  job_title:           string | null
  department:          string | null
  default_company_id:  string | null
  avatar_url:          string | null
  created_at:          string
  updated_at:          string
  companies:           string[]
  company_roles:       Record<string, string>
}

interface CompanyMember {
  company_id: string
  role:       string
  status:     string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPANY_OPTIONS = [
  { id: "grupo",   label: "Grupo Mota Educação" },
  { id: "cppem",  label: "CPPEM Concursos" },
  { id: "unicive", label: "Unicive" },
  { id: "colegio", label: "Colégio CPPEM" },
  { id: "everton", label: "Everton Mota" },
]

const ROLE_OPTIONS = [
  { id: "admin",  label: "Admin Global" },
  { id: "member", label: "Membro" },
]

const COMPANY_ROLE_OPTIONS = [
  { id: "admin",   label: "Admin" },
  { id: "manager", label: "Gerente" },
  { id: "member",  label: "Membro" },
]

function companyLabel(id: string) {
  return COMPANY_OPTIONS.find((c) => c.id === id)?.label ?? id
}

function initials(user: UserProfile) {
  const src = user.name ?? user.email
  return src.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
}

function avatarColor(email: string) {
  const colors = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#16a34a", "#06b6d4", "#f59e0b"]
  let h = 0
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditUserModal({
  user,
  currentUserId,
  onClose,
  onSaved,
  onDeleted,
}: {
  user:          UserProfile
  currentUserId: string | null
  onClose:       () => void
  onSaved:       (u: UserProfile) => void
  onDeleted:     (id: string) => void
}) {
  const [name,      setName]      = useState(user.name ?? "")
  const [jobTitle,  setJobTitle]  = useState(user.job_title ?? "")
  const [dept,      setDept]      = useState(user.department ?? "")
  const [role,      setRole]      = useState(user.role)
  const [defCo,     setDefCo]     = useState(user.default_company_id ?? "")

  const [members,   setMembers]   = useState<CompanyMember[]>([])
  const [loadingM,  setLoadingM]  = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const [addCo,     setAddCo]     = useState("")
  const [addRole,   setAddRole]   = useState("member")

  const [togglingAdmin, setTogglingAdmin] = useState(false)
  const [linkingAll,    setLinkingAll]    = useState(false)
  const [deleting,      setDeleting]      = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isSelf  = currentUserId === user.id
  const isAdminRole = role === "admin"

  useEffect(() => {
    fetch(`/api/users/${user.id}/companies`)
      .then((r) => r.json() as Promise<{ members?: CompanyMember[] }>)
      .then(({ members: m }) => setMembers(m ?? []))
      .catch(() => {})
      .finally(() => setLoadingM(false))
  }, [user.id])

  // Promove/rebaixa admin imediatamente (sem precisar salvar o perfil inteiro)
  async function handleToggleAdmin() {
    const next = isAdminRole ? "member" : "admin"
    setTogglingAdmin(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      })
      const json = await res.json() as { user?: UserProfile; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro ao alterar papel")
      setRole(next)
      onSaved({ ...user, ...json.user!, companies: user.companies, company_roles: user.company_roles })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao alterar papel")
    } finally {
      setTogglingAdmin(false)
    }
  }

  // Vincula o usuário a TODAS as empresas de uma vez
  async function handleLinkAllCompanies() {
    setLinkingAll(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/${user.id}/companies`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true, role: "member" }),
      })
      const json = await res.json() as { members?: CompanyMember[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro ao vincular empresas")
      // Recarrega a lista de vínculos
      const refreshed = await fetch(`/api/users/${user.id}/companies`)
        .then((r) => r.json() as Promise<{ members?: CompanyMember[] }>)
      setMembers(refreshed.members ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao vincular empresas")
    } finally {
      setLinkingAll(false)
    }
  }

  // Exclui o usuário definitivamente
  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" })
      const json = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro ao excluir usuário")
      onDeleted(user.id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao excluir usuário")
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  async function handleSaveProfile() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || null,
          job_title:          jobTitle.trim(),
          department:         dept.trim(),
          role,
          default_company_id: defCo || null,
        }),
      })
      const json = await res.json() as { user?: UserProfile; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar")
      onSaved({ ...user, ...json.user!, companies: user.companies, company_roles: user.company_roles })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar")
    } finally {
      setSaving(false)
    }
  }

  async function handleAddCompany() {
    if (!addCo) return
    try {
      const res = await fetch(`/api/users/${user.id}/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: addCo, role: addRole, status: "active" }),
      })
      const json = await res.json() as { member?: CompanyMember; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro")
      setMembers((prev) => {
        const filtered = prev.filter((m) => m.company_id !== addCo)
        return [...filtered, json.member!]
      })
      setAddCo("")
      setAddRole("member")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro")
    }
  }

  async function handleRemoveCompany(companyId: string) {
    try {
      const res = await fetch(`/api/users/${user.id}/companies?company_id=${companyId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Erro ao remover")
      setMembers((prev) => prev.filter((m) => m.company_id !== companyId))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro")
    }
  }

  const color = avatarColor(user.email)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.15 }}
        className="relative w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 border-b shrink-0"
          style={{ borderColor: "var(--border-color)" }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
            style={{ background: color }}
          >
            {initials(user)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {user.name ?? user.email}
            </p>
            <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
              {user.email}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Profile fields */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Perfil
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>
                  Nome
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-lg border outline-none focus:border-mota-500 transition-colors"
                  style={{
                    background: "var(--bg-hover)",
                    borderColor: "var(--border-color)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>
                  Cargo / Função
                </label>
                <input
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-lg border outline-none focus:border-mota-500 transition-colors"
                  style={{
                    background: "var(--bg-hover)",
                    borderColor: "var(--border-color)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>
                  Setor
                </label>
                <input
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-lg border outline-none focus:border-mota-500 transition-colors"
                  style={{
                    background: "var(--bg-hover)",
                    borderColor: "var(--border-color)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>
                  Papel global
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-lg border outline-none focus:border-mota-500 transition-colors"
                  style={{
                    background: "var(--bg-hover)",
                    borderColor: "var(--border-color)",
                    color: "var(--text-primary)",
                  }}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>
                  Empresa padrão
                </label>
                <select
                  value={defCo}
                  onChange={(e) => setDefCo(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-lg border outline-none focus:border-mota-500 transition-colors"
                  style={{
                    background: "var(--bg-hover)",
                    borderColor: "var(--border-color)",
                    color: "var(--text-primary)",
                  }}
                >
                  <option value="">— Nenhuma —</option>
                  {COMPANY_OPTIONS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Company memberships */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Empresas vinculadas
              </p>
              <button
                onClick={() => void handleLinkAllCompanies()}
                disabled={linkingAll}
                className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
                style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
              >
                {linkingAll ? <Loader2 size={11} className="animate-spin" /> : <Building2 size={11} />}
                Vincular a todas
              </button>
            </div>

            {loadingM ? (
              <div className="flex justify-center py-4">
                <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />
              </div>
            ) : (
              <div className="space-y-1.5">
                {members.filter((m) => m.status === "active").map((m) => (
                  <div
                    key={m.company_id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border"
                    style={{ borderColor: "var(--border-color)", background: "var(--bg-hover)" }}
                  >
                    <Building2 size={13} style={{ color: "var(--text-muted)" }} />
                    <span className="flex-1 text-xs" style={{ color: "var(--text-primary)" }}>
                      {companyLabel(m.company_id)}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-mota-500/10 text-mota-500">
                      {COMPANY_ROLE_OPTIONS.find((r) => r.id === m.role)?.label ?? m.role}
                    </span>
                    <button
                      onClick={() => void handleRemoveCompany(m.company_id)}
                      className="p-1 rounded transition-colors hover:bg-red-500/10 hover:text-red-400"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}

                {/* Add company row */}
                <div className="flex items-center gap-2 pt-1">
                  <select
                    value={addCo}
                    onChange={(e) => setAddCo(e.target.value)}
                    className="flex-1 text-xs px-2.5 py-2 rounded-lg border outline-none focus:border-mota-500 transition-colors"
                    style={{
                      background: "var(--bg-hover)",
                      borderColor: "var(--border-color)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <option value="">+ Adicionar empresa…</option>
                    {COMPANY_OPTIONS
                      .filter((c) => !members.some((m) => m.company_id === c.id && m.status === "active"))
                      .map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                  </select>
                  {addCo && (
                    <>
                      <select
                        value={addRole}
                        onChange={(e) => setAddRole(e.target.value)}
                        className="text-xs px-2.5 py-2 rounded-lg border outline-none focus:border-mota-500 transition-colors w-28"
                        style={{
                          background: "var(--bg-hover)",
                          borderColor: "var(--border-color)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {COMPANY_ROLE_OPTIONS.map((r) => (
                          <option key={r.id} value={r.id}>{r.label}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => void handleAddCompany()}
                        className="h-8 w-8 flex items-center justify-center rounded-lg bg-mota-600 hover:bg-mota-700 text-white transition-colors shrink-0"
                      >
                        <Check size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Ações administrativas */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Ações administrativas
            </p>

            {/* Toggle admin */}
            <button
              onClick={() => void handleToggleAdmin()}
              disabled={togglingAdmin}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
              style={{ borderColor: "var(--border-color)" }}
            >
              {togglingAdmin
                ? <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                : isAdminRole
                  ? <ShieldOff size={14} className="text-amber-400" />
                  : <Shield size={14} className="text-violet-400" />
              }
              <span className="flex-1 text-left text-xs" style={{ color: "var(--text-primary)" }}>
                {isAdminRole ? "Remover admin global" : "Tornar admin global"}
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {isAdminRole ? "Admin" : "Membro"}
              </span>
            </button>

            {/* Excluir usuário */}
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={isSelf}
                title={isSelf ? "Você não pode excluir a própria conta" : undefined}
                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-red-500/30 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <Trash2 size={14} />
                <span className="flex-1 text-left text-xs">Excluir usuário</span>
                {isSelf && <Lock size={12} />}
              </button>
            ) : (
              <div className="flex flex-col gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/5">
                <p className="text-xs text-red-300">
                  Excluir <strong>{user.name ?? user.email}</strong> permanentemente? Esta ação remove o login, o perfil e todos os vínculos. Não pode ser desfeita.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="flex-1 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
                    style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Excluir definitivamente
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle size={12} /> {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0"
          style={{ borderColor: "var(--border-color)" }}
        >
          <button
            onClick={onClose}
            className="text-xs px-4 py-2 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]"
            style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
          >
            Fechar
          </button>
          <button
            onClick={() => void handleSaveProfile()}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl font-semibold text-white bg-mota-600 hover:bg-mota-700 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Salvar perfil
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

function InviteUserModal({
  onClose,
  onInvited,
}: {
  onClose:   () => void
  onInvited: () => void
}) {
  const [name,    setName]    = useState("")
  const [email,   setEmail]   = useState("")
  const [company, setCompany] = useState("grupo")
  const [sending, setSending] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSubmit() {
    if (!name.trim())  { setError("Informe o nome do usuário."); return }
    if (!email.trim()) { setError("Informe o e-mail."); return }
    setSending(true)
    setError(null)
    try {
      const form = new FormData()
      form.append("name", name.trim())
      form.append("email", email.trim())
      form.append("company_id", company)

      const res  = await fetch("/api/users", { method: "POST", body: form })
      const json = await res.json() as { message?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro ao enviar convite")

      showSuccess(json.message ?? `Convite enviado para ${email}`)
      onInvited()
      onClose()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao enviar convite"
      setError(msg)
      showError(msg)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.15 }}
        className="relative w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 border-b"
          style={{ borderColor: "var(--border-color)" }}
        >
          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-mota-600/15 shrink-0">
            <UserPlus size={16} className="text-mota-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Convidar usuário
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Enviaremos um e-mail para definir a senha
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>
              Nome
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome completo"
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none focus:border-mota-500 transition-colors"
              style={{ background: "var(--bg-hover)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
            />
          </div>
          <div>
            <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>
              E-mail
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@email.com"
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none focus:border-mota-500 transition-colors"
              style={{ background: "var(--bg-hover)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
            />
          </div>
          <div>
            <label className="text-[11px] font-medium mb-1 block" style={{ color: "var(--text-muted)" }}>
              Empresa padrão
            </label>
            <select
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none focus:border-mota-500 transition-colors"
              style={{ background: "var(--bg-hover)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
            >
              {COMPANY_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle size={12} /> {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: "var(--border-color)" }}
        >
          <button
            onClick={onClose}
            className="text-xs px-4 py-2 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]"
            style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={sending}
            className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl font-semibold text-white bg-mota-600 hover:bg-mota-700 transition-colors disabled:opacity-50"
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
            Enviar convite
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const { isAdmin, loading: companyLoading } = useCompany()

  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [users,    setUsers]    = useState<UserProfile[]>([])
  const [loading,  setLoading]  = useState(true)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const [search,   setSearch]   = useState("")
  const [editing,  setEditing]  = useState<UserProfile | null>(null)
  const [inviting, setInviting] = useState(false)
  const [companyFilter, setCompanyFilter] = useState("")

  useEffect(() => {
    createClient().auth.getUser()
      .then(({ data }) => setCurrentUserId(data.user?.id ?? null))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setFetchErr(null)
    try {
      const params = new URLSearchParams()
      if (search)        params.set("search",     search)
      if (companyFilter) params.set("company_id", companyFilter)
      const qs  = params.toString() ? `?${params.toString()}` : ""
      const res  = await fetch(`/api/users${qs}`)
      const json = await res.json() as { users?: UserProfile[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro ao carregar usuários")
      setUsers(json.users ?? [])
    } catch (e: unknown) {
      setFetchErr(e instanceof Error ? e.message : "Erro desconhecido")
    } finally {
      setLoading(false)
    }
  }, [search, companyFilter])

  useEffect(() => { void load() }, [load])

  function handleSaved(updated: UserProfile) {
    setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u))
  }

  function handleDeleted(id: string) {
    setUsers((prev) => prev.filter((u) => u.id !== id))
    setEditing(null)
  }

  const adminCount  = users.filter((u) => u.role === "admin").length
  const activeCount = users.filter((u) => u.companies.length > 0).length

  // Enquanto o contexto de permissões carrega, evita flash da tela para não-admin
  if (companyLoading) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <PageHeader title="Gestão de Usuários" subtitle="Carregando…" />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        </div>
      </div>
    )
  }

  // ─── Gate de admin: apenas admin global acessa esta tela ────────────────────
  if (!isAdmin) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <PageHeader title="Gestão de Usuários" subtitle="Acesso restrito" />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
          <Lock size={28} style={{ color: "var(--text-muted)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Acesso restrito a administradores
          </p>
          <p className="text-xs text-center max-w-sm" style={{ color: "var(--text-muted)" }}>
            Apenas administradores globais podem gerenciar usuários, papéis e vínculos de empresa.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Gestão de Usuários"
        subtitle={loading ? "Carregando…" : `${users.length} usuário${users.length !== 1 ? "s" : ""} · ${adminCount} admin`}
        actions={
          <button
            onClick={() => setInviting(true)}
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-mota-600 hover:bg-mota-700 text-white transition-colors"
          >
            <UserPlus size={13} /> Convidar usuário
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-screen-lg mx-auto space-y-5">

          {/* Stats */}
          {!loading && !fetchErr && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total",          value: users.length,  color: "#16a34a" },
                { label: "Com empresa",    value: activeCount,   color: "#3b82f6" },
                { label: "Admins globais", value: adminCount,    color: "#8b5cf6" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl p-4 border"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
                >
                  <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div
              className="flex items-center gap-2 rounded-xl px-3 h-9 border flex-1 max-w-72"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
            >
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou e-mail…"
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]"
                style={{ color: "var(--text-primary)" }}
              />
            </div>

            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="h-9 text-xs px-3 rounded-xl border outline-none transition-colors hover:bg-[var(--bg-hover)]"
              style={{
                background: "var(--bg-card)",
                borderColor: "var(--border-color)",
                color: "var(--text-secondary)",
              }}
            >
              <option value="">Todas as empresas</option>
              {COMPANY_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          )}

          {/* Error */}
          {fetchErr && (
            <div className="flex flex-col items-center gap-3 py-12">
              <AlertCircle size={22} className="text-red-400" />
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{fetchErr}</p>
              <button
                onClick={() => void load()}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]"
                style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
              >
                <RefreshCw size={12} /> Tentar novamente
              </button>
            </div>
          )}

          {/* Table */}
          {!loading && !fetchErr && (
            <div
              className="rounded-2xl border overflow-hidden"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
            >
              {users.length === 0 ? (
                search || companyFilter ? (
                  <EmptyState
                    icon={Search}
                    title="Nenhum usuário encontrado"
                    description="Nenhum resultado para este filtro. Tente ajustar a busca ou a empresa."
                  />
                ) : (
                  <EmptyState
                    icon={Users}
                    title="Nenhum usuário ainda"
                    description="Convide os funcionários por e-mail para que definam a própria senha e comecem a usar o sistema."
                    action={{
                      label:   "Convidar usuário",
                      icon:    UserPlus,
                      onClick: () => setInviting(true),
                    }}
                  />
                )
              ) : (
                <table className="w-full">
                  <thead>
                    <tr
                      className="border-b text-[11px] uppercase tracking-wide"
                      style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
                    >
                      <th className="px-4 py-3 text-left font-medium">Usuário</th>
                      <th className="px-4 py-3 text-left font-medium hidden md:table-cell">Cargo / Setor</th>
                      <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Empresas</th>
                      <th className="px-4 py-3 text-left font-medium">Papel</th>
                      <th className="px-4 py-3 text-right font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, i) => {
                      const color = avatarColor(u.email)
                      return (
                        <motion.tr
                          key={u.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className="border-b last:border-0 hover:bg-[var(--bg-hover)] transition-colors"
                          style={{ borderColor: "var(--border-color)" }}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                                style={{ background: color }}
                              >
                                {initials(u)}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                                  {u.name ?? "—"}
                                </p>
                                <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                                  {u.email}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                              {u.job_title || "—"}
                            </p>
                            {u.department && (
                              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                                {u.department}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <div className="flex flex-wrap gap-1">
                              {u.companies.length === 0 ? (
                                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>—</span>
                              ) : (
                                u.companies.slice(0, 3).map((c) => (
                                  <span
                                    key={c}
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-mota-500/10 text-mota-500"
                                  >
                                    {c}
                                  </span>
                                ))
                              )}
                              {u.companies.length > 3 && (
                                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                                  +{u.companies.length - 3}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {u.role === "admin" ? (
                              <span className="flex items-center gap-1 text-[11px] text-violet-400">
                                <Shield size={11} /> Admin
                              </span>
                            ) : (
                              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                                Membro
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => setEditing(u)}
                              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)]"
                              style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
                            >
                              <Pencil size={11} /> Editar
                            </button>
                          </td>
                        </motion.tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {editing && (
          <EditUserModal
            user={editing}
            currentUserId={currentUserId}
            onClose={() => setEditing(null)}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
          />
        )}
      </AnimatePresence>

      {/* Invite modal */}
      <AnimatePresence>
        {inviting && (
          <InviteUserModal
            onClose={() => setInviting(false)}
            onInvited={() => void load()}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
