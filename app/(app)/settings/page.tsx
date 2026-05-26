"use client"

import { useState, useEffect, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import {
  User, Building2, Users, Brain, KeyRound,
  Database, Palette, ShieldCheck, ScrollText,
  Check, Moon, Sun, Monitor, AlertCircle,
  RefreshCw, Trash2, LogOut, Loader2, Link2, Link2Off,
} from "lucide-react"
import { PageHeader } from "@/components/ui/PageHeader"
import { useThemeContext } from "@/components/layout/ThemeProvider"
import { createClient as createBrowserClient } from "@/lib/supabase-browser"
import { cn } from "@/lib/utils"
import { RocketChatDestinations } from "@/components/settings/RocketChatDestinations"
import { useCompany } from "@/components/providers/CompanyProvider"


type SettingsTab =
  | "profile" | "companies" | "users" | "models"
  | "apis" | "supabase" | "appearance" | "security" | "logs"

const settingsTabs: { id: SettingsTab; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: "profile",    label: "Perfil",         icon: User        },
  { id: "companies",  label: "Empresas",        icon: Building2,  adminOnly: true },
  { id: "users",      label: "Usuários",        icon: Users,      adminOnly: true },
  { id: "models",     label: "Modelos de IA",   icon: Brain,      adminOnly: true },
  { id: "apis",       label: "APIs",            icon: KeyRound,   adminOnly: true },
  { id: "supabase",   label: "Supabase",        icon: Database,   adminOnly: true },
  { id: "appearance", label: "Aparência",       icon: Palette     },
  { id: "security",   label: "Segurança",       icon: ShieldCheck },
  { id: "logs",       label: "Logs",            icon: ScrollText, adminOnly: true },
]

export default function SettingsPage() {
  const { isAdmin, loading: companyLoading } = useCompany()
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get("tab") as SettingsTab | null) ?? "profile"
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)

  const visibleTabs = companyLoading
    ? settingsTabs.filter(t => !t.adminOnly)
    : settingsTabs.filter(t => !t.adminOnly || isAdmin)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Configurações" subtitle="Gerencie perfil, integrações e preferências do sistema" />

      <div className="flex flex-1 overflow-hidden">
        {/* Left nav */}
        <div
          className="w-52 shrink-0 border-r overflow-y-auto p-3 space-y-0.5"
          style={{ borderColor: "var(--border-color)", background: "var(--bg-sidebar)" }}
        >
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors text-left",
                activeTab === t.id
                  ? "bg-[var(--bg-active)] text-mota-600 dark:text-mota-500 font-medium"
                  : "hover:bg-[var(--bg-hover)]"
              )}
              style={{ color: activeTab === t.id ? undefined : "var(--text-secondary)" }}
            >
              <t.icon size={14} className="shrink-0" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-2xl mx-auto">
            {activeTab === "profile"    && <ProfileTab />}
            {activeTab === "companies"  && <CompaniesTab />}
            {activeTab === "users"      && <UsersTab />}
            {activeTab === "models"     && <ModelsTab />}
            {activeTab === "apis"       && <ApisTab />}
            {activeTab === "supabase"   && <SupabaseTab />}
            {activeTab === "appearance" && <AppearanceTab />}
            {activeTab === "security"   && <SecurityTab />}
            {activeTab === "logs"       && <LogsTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Shared primitives ─── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-bold mb-5" style={{ color: "var(--text-primary)" }}>
      {children}
    </h2>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  )
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-xl px-3 py-2.5 text-xs border outline-none placeholder:text-[var(--text-muted)] transition-colors focus:border-mota-500"
      style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
    />
  )
}

function Select({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl px-3 py-2.5 text-xs border outline-none appearance-none"
      style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
    >
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  )
}

function SaveButton({ label = "Salvar alterações" }: { label?: string }) {
  const [saved, setSaved] = useState(false)
  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }
  return (
    <button
      onClick={handleSave}
      className={cn(
        "flex items-center gap-2 text-xs px-5 py-2.5 rounded-xl font-semibold transition-all text-white",
        saved ? "bg-mota-500" : "bg-mota-600 hover:bg-mota-700"
      )}
    >
      {saved ? <><Check size={13} /> Salvo!</> : label}
    </button>
  )
}

function Divider() {
  return <div className="border-t my-6" style={{ borderColor: "var(--border-color)" }} />
}

/* ─── Profile ─── */

interface ProfileData {
  id:                 string
  email:              string
  name:               string
  role:               string
  job_title:          string
  default_company_id: string
  avatar_url:         string | null
  updated_at:         string | null
}

interface CompanyItem {
  id:          string
  slug:        string
  name:        string
  description: string
  color:       string
  initials:    string
  active:      boolean
  logo_url:    string | null
  updated_at:  string | null
}

function ProfileTab() {
  const [profile,   setProfile]   = useState<ProfileData | null>(null)
  const [companies, setCompanies] = useState<CompanyItem[]>([])
  const [draft,     setDraft]     = useState<Partial<ProfileData>>({})
  const [loading,   setLoading]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [feedback,  setFeedback]  = useState<"ok" | "error" | null>(null)
  const [fetchErr,  setFetchErr]  = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/profile").then((r) => {
        if (!r.ok) throw new Error(`Perfil: HTTP ${r.status}`)
        return r.json() as Promise<ProfileData>
      }),
      fetch("/api/companies").then((r) => {
        if (!r.ok) throw new Error(`Empresas: HTTP ${r.status}`)
        return r.json() as Promise<CompanyItem[]>
      }),
    ])
      .then(([prof, comps]) => { setProfile(prof); setCompanies(comps) })
      .catch((e: Error) => setFetchErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  const d = profile ? { ...profile, ...draft } : null

  async function handleSave() {
    if (!d) return
    setSaving(true)
    setFeedback(null)
    try {
      const res  = await fetch("/api/profile", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:               d.name,
          job_title:          d.job_title,
          default_company_id: d.default_company_id,
        }),
      })
      const json = await res.json() as { ok?: boolean; error?: string } & Partial<ProfileData>
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar")
      setProfile((prev) => prev ? { ...prev, ...json } : prev)
      setDraft({})
      setFeedback("ok")
      setTimeout(() => setFeedback(null), 2500)
    } catch {
      setFeedback("error")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
    </div>
  )

  if (fetchErr || !d) return (
    <div className="py-8 text-center space-y-2">
      <p className="text-xs" style={{ color: "#ef4444" }}>
        {fetchErr ?? "Erro ao carregar perfil"}
      </p>
      <button
        onClick={() => { setFetchErr(null); setLoading(true); Promise.all([fetch("/api/profile").then((r) => r.json() as Promise<ProfileData>), fetch("/api/companies").then((r) => r.json() as Promise<CompanyItem[]>)]).then(([p, c]) => { setProfile(p); setCompanies(c) }).catch((e: Error) => setFetchErr(e.message)).finally(() => setLoading(false)) }}
        className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)]"
        style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
      >
        Tentar novamente
      </button>
    </div>
  )

  const initial = (d.name[0] ?? d.email[0] ?? "U").toUpperCase()
  const isDirty = Object.keys(draft).length > 0

  return (
    <div className="space-y-5">
      <SectionTitle>Perfil</SectionTitle>

      <div
        className="flex items-center gap-4 p-5 rounded-2xl border"
        style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
      >
        <div className="w-16 h-16 rounded-2xl bg-mota-600 flex items-center justify-center shrink-0">
          <span className="text-white text-xl font-bold">{initial}</span>
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{d.name || d.email.split("@")[0]}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{d.email}</p>
          <p className="text-[10px] mt-0.5 capitalize" style={{ color: "var(--text-muted)" }}>{d.role}</p>
        </div>
      </div>

      <div className="space-y-4">
        <Field label="E-mail">
          <Input type="email" value={d.email} readOnly disabled />
        </Field>
        <Field label="Nome">
          <Input
            value={d.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Seu nome completo"
          />
        </Field>
        <Field label="Cargo">
          <Input
            value={d.job_title}
            onChange={(e) => setDraft((prev) => ({ ...prev, job_title: e.target.value }))}
            placeholder="Ex: Coordenador de Marketing"
          />
        </Field>
        <Field label="Empresa padrão">
          <select
            value={d.default_company_id}
            onChange={(e) => setDraft((prev) => ({ ...prev, default_company_id: e.target.value }))}
            className="w-full rounded-xl px-3 py-2.5 text-xs border outline-none appearance-none"
            style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
          >
            {companies.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div>
          {feedback === "ok" && (
            <span className="text-xs flex items-center gap-1" style={{ color: "#16a34a" }}>
              <Check size={12} /> Perfil salvo
            </span>
          )}
          {feedback === "error" && (
            <span className="text-xs" style={{ color: "#ef4444" }}>Erro ao salvar</span>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="flex items-center gap-2 text-xs px-5 py-2.5 rounded-xl font-semibold text-white transition-all bg-mota-600 hover:bg-mota-700 disabled:opacity-50"
        >
          {saving ? <><Loader2 size={12} className="animate-spin" /> Salvando...</> : "Salvar alterações"}
        </button>
      </div>
    </div>
  )
}

/* ─── Companies ─── */

interface CompanyMember {
  id:         string
  company_id: string
  user_id:    string
  role:       string
  status:     string
  created_at: string
  user_name:  string
  user_email: string
}

interface UserItem {
  id:    string
  email: string
  name:  string
}

const MEMBER_ROLES = ["owner", "admin", "manager", "member", "viewer"] as const

const ROLE_COLORS: Record<string, string> = {
  owner:   "#f97316",
  admin:   "#ef4444",
  manager: "#8b5cf6",
  member:  "#3b82f6",
  viewer:  "#94a3b8",
}

function CompanyMembersSection({ companySlug, isAdmin }: { companySlug: string; isAdmin: boolean }) {
  const [members,   setMembers]   = useState<CompanyMember[]>([])
  const [allUsers,  setAllUsers]  = useState<UserItem[]>([])
  const [loading,   setLoading]   = useState(true)
  const [fetchErr,  setFetchErr]  = useState<string | null>(null)
  const [addUserId, setAddUserId] = useState("")
  const [addRole,   setAddRole]   = useState("member")
  const [adding,    setAdding]    = useState(false)
  const [removing,  setRemoving]  = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [membersRes, usersRes] = await Promise.all([
          fetch(`/api/company-members?company_id=${companySlug}`),
          isAdmin ? fetch("/api/users") : Promise.resolve(null),
        ])
        if (!membersRes.ok) throw new Error(`HTTP ${membersRes.status}`)
        setMembers(await membersRes.json() as CompanyMember[])
        if (usersRes?.ok) {
          const usersJson = await usersRes.json() as { users?: UserItem[] } | UserItem[]
          setAllUsers(Array.isArray(usersJson) ? usersJson : (usersJson.users ?? []))
        }
      } catch (e: unknown) {
        setFetchErr(e instanceof Error ? e.message : "Erro ao carregar membros")
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [companySlug, isAdmin])

  async function handleAdd() {
    if (!addUserId) return
    setAdding(true)
    try {
      const res = await fetch("/api/company-members", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ company_id: companySlug, user_id: addUserId, role: addRole }),
      })
      const json = await res.json() as { error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro ao adicionar")
      const refresh = await fetch(`/api/company-members?company_id=${companySlug}`)
      setMembers(await refresh.json() as CompanyMember[])
      setAddUserId("")
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Erro ao adicionar")
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(userId: string) {
    setRemoving(userId)
    try {
      await fetch("/api/company-members", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ company_id: companySlug, user_id: userId }),
      })
      setMembers(prev => prev.filter(m => m.user_id !== userId))
    } finally {
      setRemoving(null)
    }
  }

  async function handleRoleChange(userId: string, role: string) {
    const res = await fetch("/api/company-members", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ company_id: companySlug, user_id: userId, role }),
    })
    if (res.ok) setMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role } : m))
  }

  const existingIds    = new Set(members.map(m => m.user_id))
  const usersArray     = Array.isArray(allUsers) ? allUsers : []
  const availableUsers = usersArray.filter(u => !existingIds.has(u.id))

  return (
    <div className="space-y-3 pt-4 border-t" style={{ borderColor: "var(--border-color)" }}>
      <p className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>Membros</p>

      {loading && (
        <div className="flex items-center gap-2 py-2">
          <Loader2 size={12} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Carregando...</span>
        </div>
      )}

      {fetchErr && !loading && (
        <p className="text-[11px]" style={{ color: "#ef4444" }}>Erro: {fetchErr}</p>
      )}

      {!loading && !fetchErr && members.length === 0 && (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Nenhum membro cadastrado.</p>
      )}

      {!loading && members.map(m => (
        <div key={m.id} className="flex items-center gap-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-xs truncate" style={{ color: "var(--text-primary)" }}>
              {m.user_name || m.user_email}
            </p>
            {m.user_name && (
              <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{m.user_email}</p>
            )}
          </div>
          {isAdmin ? (
            <select
              value={m.role}
              onChange={(e) => void handleRoleChange(m.user_id, e.target.value)}
              className="text-[10px] px-2 py-1 rounded-lg border outline-none"
              style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: ROLE_COLORS[m.role] ?? "var(--text-secondary)" }}
            >
              {MEMBER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          ) : (
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
              style={{ background: `${ROLE_COLORS[m.role] ?? "#94a3b8"}18`, color: ROLE_COLORS[m.role] ?? "#94a3b8" }}
            >
              {m.role}
            </span>
          )}
          {isAdmin && (
            <button
              onClick={() => void handleRemove(m.user_id)}
              disabled={removing === m.user_id}
              className="shrink-0 p-1 rounded-lg transition-colors hover:bg-red-500/10 disabled:opacity-40"
              style={{ color: "#ef4444" }}
              title="Remover membro"
            >
              {removing === m.user_id
                ? <Loader2 size={11} className="animate-spin" />
                : <Trash2 size={11} />
              }
            </button>
          )}
        </div>
      ))}

      {isAdmin && !loading && availableUsers.length > 0 && (
        <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: "var(--border-color)" }}>
          <select
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            className="flex-1 rounded-xl px-2 py-1.5 text-xs border outline-none"
            style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
          >
            <option value="">Selecionar usuário...</option>
            {availableUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
          <select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value)}
            className="rounded-xl px-2 py-1.5 text-xs border outline-none shrink-0"
            style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
          >
            {MEMBER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={() => void handleAdd()}
            disabled={adding || !addUserId}
            className="flex items-center gap-1 shrink-0 text-xs px-3 py-1.5 rounded-xl font-semibold text-white bg-mota-600 hover:bg-mota-700 disabled:opacity-50 transition-all"
          >
            {adding ? <Loader2 size={11} className="animate-spin" /> : "Adicionar"}
          </button>
        </div>
      )}

      {isAdmin && !loading && usersArray.length > 0 && availableUsers.length === 0 && (
        <p className="text-[11px] pt-2 border-t" style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}>
          Nenhum usuário disponível para adicionar.
        </p>
      )}
    </div>
  )
}

function CompaniesTab() {
  const [companies,  setCompanies]  = useState<CompanyItem[]>([])
  const [userRole,   setUserRole]   = useState<string | null>(null)
  const [expanded,   setExpanded]   = useState<string | null>(null)
  const [drafts,     setDrafts]     = useState<Record<string, Partial<CompanyItem>>>({})
  const [saving,     setSaving]     = useState<string | null>(null)
  const [feedback,   setFeedback]   = useState<Record<string, "ok" | "error" | null>>({})
  const [loading,    setLoading]    = useState(true)
  const [fetchErr,   setFetchErr]   = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch("/api/companies").then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<CompanyItem[]>
      }),
      fetch("/api/profile").then((r) => {
        if (!r.ok) return { role: "viewer" }
        return r.json() as Promise<{ role: string }>
      }),
    ])
      .then(([comps, prof]) => { setCompanies(comps); setUserRole(prof.role) })
      .catch((e: Error) => setFetchErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  const isAdmin = userRole === "admin"

  function getDraft(id: string): CompanyItem {
    const base = companies.find((c) => c.id === id)!
    return { ...base, ...(drafts[id] ?? {}) }
  }

  function updateDraft(id: string, updates: Partial<CompanyItem>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...updates } }))
  }

  async function handleSave(id: string) {
    const d = getDraft(id)
    setSaving(id)
    setFeedback((prev) => ({ ...prev, [id]: null }))
    try {
      const res  = await fetch("/api/companies", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          id,
          name:        d.name,
          description: d.description,
          color:       d.color,
          active:      d.active,
        }),
      })
      const json = await res.json() as { ok?: boolean; error?: string } & Partial<CompanyItem>
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar")
      setCompanies((prev) => prev.map((c) => c.id === id ? { ...c, ...json } : c))
      setDrafts((prev) => { const n = { ...prev }; delete n[id]; return n })
      setFeedback((prev) => ({ ...prev, [id]: "ok" }))
      setTimeout(() => setFeedback((prev) => ({ ...prev, [id]: null })), 2500)
    } catch {
      // Erro detalhado já é registrado no servidor via activity-logger.
      setFeedback((prev) => ({ ...prev, [id]: "error" }))
    } finally {
      setSaving(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
    </div>
  )

  if (fetchErr) return (
    <div className="py-8 text-center space-y-2">
      <p className="text-xs" style={{ color: "#ef4444" }}>Erro ao carregar empresas: {fetchErr}</p>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <SectionTitle>Empresas</SectionTitle>
      </div>

      {!isAdmin && userRole !== null && (
        <div
          className="flex items-start gap-2 p-3 rounded-xl text-[11px]"
          style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", color: "#92400e" }}
        >
          <AlertCircle size={13} className="mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
          <span>Permissão administrativa necessária para editar empresas. Leitura disponível para todos.</span>
        </div>
      )}

      <div className="space-y-2">
        {companies.map((company) => {
          const d        = isAdmin ? getDraft(company.id) : company
          const isOpen   = expanded === company.id
          const isSaving = saving === company.id
          const fb       = feedback[company.id]
          const isDirty  = isAdmin && !!drafts[company.id]

          return (
            <div
              key={company.id}
              className="rounded-2xl border overflow-hidden"
              style={{
                background:  "var(--bg-card)",
                borderColor: isOpen ? "var(--border-active, #16a34a44)" : "var(--border-color)",
              }}
            >
              {/* Cabeçalho */}
              <button
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
                onClick={() => setExpanded(isOpen ? null : company.id)}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0"
                  style={{ background: d.color }}
                >
                  {company.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                    {d.name}
                    {isDirty && (
                      <span className="ml-2 text-[10px] font-normal" style={{ color: "#f59e0b" }}>
                        • não salvo
                      </span>
                    )}
                  </p>
                  {d.description && (
                    <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                      {d.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {fb === "ok" && (
                    <span className="text-[10px] flex items-center gap-0.5" style={{ color: "#16a34a" }}>
                      <Check size={10} /> Salvo
                    </span>
                  )}
                  {fb === "error" && (
                    <span className="text-[10px]" style={{ color: "#ef4444" }}>Erro</span>
                  )}
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={
                      d.active
                        ? { background: "rgba(22,163,74,0.1)", color: "#16a34a" }
                        : { background: "rgba(148,163,184,0.1)", color: "#94a3b8" }
                    }
                  >
                    {d.active ? "Ativa" : "Inativa"}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {isOpen ? "▲" : "▼"}
                  </span>
                </div>
              </button>

              {/* Formulário expandido */}
              {isOpen && (
                <div className="px-4 pb-5 space-y-4 border-t" style={{ borderColor: "var(--border-color)" }}>
                  {isAdmin ? (
                    <>
                      <div className="pt-4 space-y-3">
                        <Field label="Nome">
                          <Input
                            value={d.name}
                            onChange={(e) => updateDraft(company.id, { name: e.target.value })}
                            placeholder="Nome da empresa"
                          />
                        </Field>

                        <Field label="Descrição">
                          <textarea
                            value={d.description}
                            onChange={(e) => updateDraft(company.id, { description: e.target.value })}
                            rows={2}
                            placeholder="Breve descrição da empresa"
                            className="w-full rounded-xl px-3 py-2.5 text-xs border outline-none resize-none placeholder:text-[var(--text-muted)] focus:border-mota-500"
                            style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                          />
                        </Field>

                        <Field label="Cor">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-8 h-8 rounded-lg shrink-0 border"
                              style={{ background: d.color, borderColor: "var(--border-color)" }}
                            />
                            <input
                              type="color"
                              value={d.color}
                              onChange={(e) => updateDraft(company.id, { color: e.target.value })}
                              className="w-8 h-8 rounded cursor-pointer border-0 p-0 shrink-0"
                            />
                            <Input
                              value={d.color}
                              onChange={(e) => updateDraft(company.id, { color: e.target.value })}
                              placeholder="#6366f1"
                            />
                          </div>
                        </Field>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-2.5">
                          <button
                            onClick={() => updateDraft(company.id, { active: !d.active })}
                            className={cn(
                              "w-10 h-5 rounded-full transition-colors relative shrink-0",
                              d.active ? "bg-mota-600" : "bg-[var(--border-color)]"
                            )}
                          >
                            <span className={cn(
                              "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
                              d.active ? "left-5" : "left-0.5"
                            )} />
                          </button>
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {d.active ? "Ativa" : "Inativa"}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {fb === "error" && (
                            <span className="text-[11px]" style={{ color: "#ef4444" }}>Erro ao salvar</span>
                          )}
                          <button
                            onClick={() => { setDrafts((prev) => { const n = { ...prev }; delete n[company.id]; return n }) }}
                            disabled={isSaving}
                            className="text-xs px-3 py-1.5 rounded-xl border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
                            style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => handleSave(company.id)}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-xl font-semibold text-white transition-all disabled:opacity-60 bg-mota-600 hover:bg-mota-700"
                          >
                            {isSaving
                              ? <><Loader2 size={11} className="animate-spin" /> Salvando...</>
                              : "Salvar"
                            }
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="pt-4 space-y-2">
                      {company.description && (
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{company.description}</p>
                      )}
                      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        Slug: <span className="font-mono">{company.slug}</span>
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        Status: {company.active ? "Ativa" : "Inativa"}
                      </p>
                    </div>
                  )}

                  <CompanyMembersSection companySlug={company.slug} isAdmin={isAdmin} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {isAdmin && (
        <div
          className="flex items-center gap-2 p-3 rounded-xl text-[11px] cursor-not-allowed"
          style={{ background: "var(--bg-input)", border: "1px dashed var(--border-color)", color: "var(--text-muted)" }}
        >
          <span>+ Criar nova empresa requer migração de banco de dados para adicionar o slug ao enum <code className="font-mono">company_slug</code>.</span>
        </div>
      )}
    </div>
  )
}

/* ─── Users ─── */
interface AuthUser {
  id:              string
  email:           string
  name:            string
  created_at:      string
  last_sign_in_at: string | null
}

const avatarColors = ["#16a34a", "#f97316", "#8b5cf6", "#ec4899", "#3b82f6", "#f59e0b", "#06b6d4"]

function UsersTab() {
  const [users, setUsers]     = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((data: unknown) => {
        const list: AuthUser[] =
          Array.isArray(data) ? data
          : Array.isArray((data as any)?.users) ? (data as any).users
          : []
        setUsers(list)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <SectionTitle>Usuários</SectionTitle>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border-color)" }}>
          <div
            className="grid grid-cols-[1fr_auto] gap-3 px-4 py-2.5 border-b text-[11px] font-medium"
            style={{ borderColor: "var(--border-color)", color: "var(--text-muted)", background: "var(--bg-input)" }}
          >
            <span>Usuário</span>
            <span>Último acesso</span>
          </div>
          {users.length === 0 && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              Nenhum usuário encontrado
            </div>
          )}
          {users.map((u, i) => {
            const initials = (u.email[0] ?? "?").toUpperCase()
            const color    = avatarColors[i % avatarColors.length]
            const lastSeen = u.last_sign_in_at
              ? new Date(u.last_sign_in_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
              : "Nunca"
            return (
              <div
                key={u.id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 border-b last:border-b-0"
                style={{ borderColor: "var(--border-color)", background: "var(--bg-card)" }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                    style={{ background: color }}
                  >
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{u.name || u.email}</p>
                    <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                      Membro desde {new Date(u.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>{lastSeen}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─── Models ─── */

const PROVIDERS = ["anthropic", "openai", "gemini", "deepseek"] as const

const MODEL_OPTIONS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
  openai:    ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  gemini:    ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"],
  deepseek:  ["deepseek-chat", "deepseek-reasoner"],
}

interface AgentCfg {
  agent_id:      string
  agent_name:    string
  agent_color:   string
  provider:      string
  model_id:      string
  system_prompt: string
  temperature:   number
  max_tokens:    number
  status:        "active" | "paused"
  updated_at:    string | null
}

function ModelsTab() {
  const [configs, setConfigs]   = useState<AgentCfg[]>([])
  const [drafts, setDrafts]     = useState<Record<string, Partial<AgentCfg>>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saving, setSaving]     = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, "ok" | "error" | null>>({})
  const [loading, setLoading]   = useState(true)
  const [fetchErr, setFetchErr] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/agent-configs")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<AgentCfg[]>
      })
      .then(setConfigs)
      .catch((e: Error) => setFetchErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  function getDraft(id: string): AgentCfg {
    const base = configs.find((c) => c.agent_id === id)!
    return { ...base, ...(drafts[id] ?? {}) } as AgentCfg
  }

  function updateDraft(id: string, updates: Partial<AgentCfg>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...updates } }))
  }

  function cancelDraft(id: string) {
    setDrafts((prev) => { const n = { ...prev }; delete n[id]; return n })
    setExpanded(null)
  }

  async function handleSave(agentId: string) {
    const d = getDraft(agentId)
    setSaving(agentId)
    setFeedback((prev) => ({ ...prev, [agentId]: null }))

    try {
      const res = await fetch("/api/agent-configs", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          agent_id:      agentId,
          provider:      d.provider,
          model_id:      d.model_id,
          system_prompt: d.system_prompt,
          temperature:   d.temperature,
          max_tokens:    d.max_tokens,
          status:        d.status,
        }),
      })
      const json = await res.json() as { ok?: boolean; updated_at?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar")

      setConfigs((prev) =>
        prev.map((c) => c.agent_id === agentId ? { ...c, ...d, updated_at: json.updated_at ?? c.updated_at } : c)
      )
      setDrafts((prev) => { const n = { ...prev }; delete n[agentId]; return n })
      setFeedback((prev) => ({ ...prev, [agentId]: "ok" }))
      setTimeout(() => setFeedback((prev) => ({ ...prev, [agentId]: null })), 2500)
    } catch {
      setFeedback((prev) => ({ ...prev, [agentId]: "error" }))
    } finally {
      setSaving(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
    </div>
  )

  if (fetchErr) return (
    <div className="py-8 text-center space-y-2">
      <p className="text-xs" style={{ color: "#ef4444" }}>Erro ao carregar configurações: {fetchErr}</p>
      <button
        onClick={() => { setFetchErr(null); setLoading(true); fetch("/api/agent-configs").then((r) => r.json()).then(setConfigs).catch((e: Error) => setFetchErr(e.message)).finally(() => setLoading(false)) }}
        className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)]"
        style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
      >
        Tentar novamente
      </button>
    </div>
  )

  if (configs.length === 0) return (
    <div className="py-8 text-center">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>Nenhum agente encontrado.</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <SectionTitle>Modelos de IA por agente</SectionTitle>
      <p className="text-[11px] -mt-2" style={{ color: "var(--text-muted)" }}>
        As alterações salvas aqui afetam imediatamente o chat para cada agente.
      </p>

      <div className="space-y-2">
        {configs.map((cfg) => {
          const d        = getDraft(cfg.agent_id)
          const isOpen   = expanded === cfg.agent_id
          const isSaving = saving === cfg.agent_id
          const fb       = feedback[cfg.agent_id]
          const isDirty  = !!drafts[cfg.agent_id]

          return (
            <div
              key={cfg.agent_id}
              className="rounded-2xl border overflow-hidden"
              style={{ background: "var(--bg-card)", borderColor: isOpen ? "var(--border-active, #16a34a44)" : "var(--border-color)" }}
            >
              {/* Cabeçalho clicável */}
              <button
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
                onClick={() => setExpanded(isOpen ? null : cfg.agent_id)}
              >
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cfg.agent_color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                    {cfg.agent_name}
                    {isDirty && (
                      <span className="ml-2 text-[10px] font-normal" style={{ color: "#f59e0b" }}>
                        • não salvo
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] mt-0.5 font-mono" style={{ color: "var(--text-muted)" }}>
                    {d.provider} / {d.model_id}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {fb === "ok" && (
                    <span className="text-[10px] flex items-center gap-0.5" style={{ color: "#16a34a" }}>
                      <Check size={10} /> Salvo
                    </span>
                  )}
                  {fb === "error" && (
                    <span className="text-[10px]" style={{ color: "#ef4444" }}>Erro</span>
                  )}
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {isOpen ? "▲" : "▼"}
                  </span>
                </div>
              </button>

              {/* Formulário expandido */}
              {isOpen && (
                <div
                  className="px-4 pb-5 space-y-4 border-t"
                  style={{ borderColor: "var(--border-color)" }}
                >
                  <div className="pt-4 grid grid-cols-2 gap-3">
                    {/* Provedor */}
                    <Field label="Provedor">
                      <select
                        value={d.provider}
                        onChange={(e) => {
                          const prov = e.target.value
                          const opts = MODEL_OPTIONS[prov] ?? []
                          updateDraft(cfg.agent_id, {
                            provider: prov,
                            model_id: opts[0] ?? d.model_id,
                          })
                        }}
                        className="w-full rounded-xl px-3 py-2.5 text-xs border outline-none"
                        style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                      >
                        {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Field>

                    {/* Modelo (input + datalist) */}
                    <Field label="Modelo" hint="Selecione ou digite">
                      <input
                        list={`mdl-${cfg.agent_id}`}
                        value={d.model_id}
                        onChange={(e) => updateDraft(cfg.agent_id, { model_id: e.target.value })}
                        className="w-full rounded-xl px-3 py-2.5 text-xs border outline-none placeholder:text-[var(--text-muted)] focus:border-mota-500"
                        style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                        placeholder="nome-do-modelo"
                      />
                      <datalist id={`mdl-${cfg.agent_id}`}>
                        {(MODEL_OPTIONS[d.provider] ?? []).map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    </Field>
                  </div>

                  {/* System Prompt */}
                  <Field label="System Prompt">
                    <textarea
                      value={d.system_prompt}
                      onChange={(e) => updateDraft(cfg.agent_id, { system_prompt: e.target.value })}
                      rows={4}
                      className="w-full rounded-xl px-3 py-2.5 text-xs border outline-none resize-y placeholder:text-[var(--text-muted)] focus:border-mota-500"
                      style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)", minHeight: 88 }}
                      placeholder="Instruções do sistema para este agente..."
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Temperatura */}
                    <Field label={`Temperatura — ${d.temperature.toFixed(2)}`} hint="0 = preciso · 1 = criativo">
                      <input
                        type="range"
                        min={0} max={1} step={0.05}
                        value={d.temperature}
                        onChange={(e) => updateDraft(cfg.agent_id, { temperature: parseFloat(e.target.value) })}
                        className="w-full mt-1 accent-mota-600"
                      />
                    </Field>

                    {/* Max Tokens */}
                    <Field label="Max Tokens">
                      <Input
                        type="number"
                        min={256}
                        max={32768}
                        step={256}
                        value={d.max_tokens}
                        onChange={(e) => updateDraft(cfg.agent_id, { max_tokens: parseInt(e.target.value, 10) || 2048 })}
                      />
                    </Field>
                  </div>

                  {/* Status + botões */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2.5">
                      <button
                        onClick={() => updateDraft(cfg.agent_id, { status: d.status === "active" ? "paused" : "active" })}
                        className={cn(
                          "w-10 h-5 rounded-full transition-colors relative shrink-0",
                          d.status === "active" ? "bg-mota-600" : "bg-[var(--border-color)]"
                        )}
                      >
                        <span className={cn(
                          "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all",
                          d.status === "active" ? "left-5" : "left-0.5"
                        )} />
                      </button>
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {d.status === "active" ? "Ativo" : "Pausado"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {fb === "error" && (
                        <span className="text-[11px]" style={{ color: "#ef4444" }}>Erro ao salvar</span>
                      )}
                      <button
                        onClick={() => cancelDraft(cfg.agent_id)}
                        disabled={isSaving}
                        className="text-xs px-3 py-1.5 rounded-xl border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
                        style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => handleSave(cfg.agent_id)}
                        disabled={isSaving}
                        className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-xl font-semibold text-white transition-all disabled:opacity-60 bg-mota-600 hover:bg-mota-700"
                      >
                        {isSaving
                          ? <><Loader2 size={11} className="animate-spin" /> Salvando...</>
                          : "Salvar"
                        }
                      </button>
                    </div>
                  </div>

                  {cfg.updated_at && (
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      Última atualização: {new Date(cfg.updated_at).toLocaleString("pt-BR")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Conta Azul Card ─── */

interface ContaAzulStatus {
  env_configured:  boolean
  connected:       boolean
  status:          string
  token_status:    "valid" | "expired" | "missing"
  expires_at:      string | null
  connected_at:    string | null
  updated_at:      string | null
  saved_endpoint:  string | null
  saved_variant:   string | null
  connection:      { id: string; status: string; last_tested_at: string | null; updated_at: string | null; error_message: string | null } | null
  recent_syncs:    Array<{ id: string; status: string; processed: number; inserted: number; failed: number; started_at: string; finished_at: string | null; error_message: string | null }>
}

interface ProbeResult {
  path:         string
  status:       number
  ok:           boolean
  count:        number | null
  fields:       string[] | null
  sample:       Record<string, string> | null
  error:        string | null
  rate_limited: boolean
}

function ContaAzulCard() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const [caStatus,       setCaStatus]       = useState<ContaAzulStatus | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [syncing,        setSyncing]        = useState(false)
  const [disconnecting,  setDisconnecting]  = useState(false)
  const [feedback,       setFeedback]       = useState<{ kind: "ok" | "error"; msg: string } | null>(null)
  const [probePath,      setProbePath]      = useState("")
  const [probingPath,    setProbingPath]    = useState(false)
  const [probeResult,    setProbeResult]    = useState<ProbeResult | null>(null)
  const [savingEndpoint, setSavingEndpoint] = useState(false)
  const [showHistory,    setShowHistory]    = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch("/api/integrations/conta-azul/status")
      .then((r) => r.json() as Promise<ContaAzulStatus>)
      .then((s) => {
        setCaStatus(s)
        // Pré-preenche o campo com o endpoint salvo (apenas na carga inicial)
        setProbePath(prev => prev || s.saved_endpoint || "")
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const err = searchParams.get("conta_azul_error")
    const ok  = searchParams.get("conta_azul_success")
    if (err) setFeedback({ kind: "error", msg: decodeURIComponent(err) })
    if (ok) {
      setFeedback({ kind: "ok", msg: "Conta Azul conectada com sucesso!" })
      router.replace("/settings?tab=apis&provider=conta_azul")
    }
  }, [load, searchParams, router])

  async function handleSync() {
    setSyncing(true)
    setFeedback(null)
    try {
      const res  = await fetch("/api/integrations/conta-azul/sync", { method: "POST" })
      const json = await res.json() as {
        ok?: boolean; error?: string; connected?: boolean
        endpoint_missing?: boolean; processed?: number; inserted?: number
      }
      if (res.status === 422 && json.endpoint_missing) {
        setFeedback({ kind: "error", msg: json.error ?? "Nenhum endpoint configurado. Teste e selecione um endpoint válido." })
        return
      }
      if (res.status === 429) {
        setFeedback({ kind: "error", msg: "Limite temporário da Conta Azul atingido. Aguarde alguns minutos e tente novamente." })
        return
      }
      if (!res.ok) throw new Error(json.error ?? "Erro na sincronização")
      const msg = (json.processed ?? 0) === 0
        ? "Nenhuma venda encontrada no período selecionado."
        : `${json.inserted ?? 0} importadas de ${json.processed ?? 0} processadas.`
      setFeedback({ kind: "ok", msg })
      load()
    } catch (e) {
      setFeedback({ kind: "error", msg: e instanceof Error ? e.message : "Erro na sincronização" })
    } finally {
      setSyncing(false)
    }
  }

  async function handleProbeOne() {
    const path = probePath.trim()
    if (!path) {
      setFeedback({ kind: "error", msg: "Informe o caminho do endpoint (ex: /v1/sales)" })
      return
    }
    setProbingPath(true)
    setProbeResult(null)
    setFeedback(null)
    const now       = new Date()
    const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
    const endDate   = now.toISOString().slice(0, 10)
    try {
      const res  = await fetch("/api/integrations/conta-azul/probe", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ path, start_date: startDate, end_date: endDate }),
      })
      const json = await res.json() as ProbeResult
      setProbeResult(json)
      if (json.rate_limited) {
        setFeedback({ kind: "error", msg: "Limite temporário da Conta Azul atingido. Aguarde alguns minutos e tente novamente." })
      }
    } catch (e) {
      setFeedback({ kind: "error", msg: e instanceof Error ? e.message : "Erro ao testar endpoint" })
    } finally {
      setProbingPath(false)
    }
  }

  async function handleSaveEndpoint(path: string) {
    setSavingEndpoint(true)
    setFeedback(null)
    try {
      await fetch("/api/integrations/conta-azul/save-endpoint", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ path, variant: "start_date/end_date" }),
      })
      setFeedback({ kind: "ok", msg: `Endpoint ${path} salvo. Clique em Sincronizar para importar os dados.` })
      setProbeResult(null)
      load()
    } catch (e) {
      setFeedback({ kind: "error", msg: e instanceof Error ? e.message : "Erro ao salvar endpoint" })
    } finally {
      setSavingEndpoint(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm("Desconectar a Conta Azul? Os tokens OAuth serão removidos, mas as vendas importadas serão mantidas.")) return
    setDisconnecting(true)
    setFeedback(null)
    try {
      const res = await fetch("/api/integrations/conta-azul/disconnect", { method: "POST" })
      if (!res.ok) throw new Error("Erro ao desconectar")
      setFeedback({ kind: "ok", msg: "Conta Azul desconectada. Tokens removidos." })
      load()
    } catch (e) {
      setFeedback({ kind: "error", msg: e instanceof Error ? e.message : "Erro" })
    } finally {
      setDisconnecting(false)
    }
  }

  const badge = (() => {
    if (loading)                             return { label: "...",           color: "#94a3b8", bg: "rgba(148,163,184,0.1)" }
    if (!caStatus?.connected)                return { label: "Não conectado", color: "#94a3b8", bg: "rgba(148,163,184,0.1)" }
    if (caStatus.token_status === "expired") return { label: "Token expirado", color: "#ef4444", bg: "rgba(239,68,68,0.1)" }
    return { label: "Conectado", color: "#16a34a", bg: "rgba(22,163,74,0.1)" }
  })()

  const isConnected = !loading && !!caStatus?.connected && caStatus.token_status !== "expired"

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{
        background:  "var(--bg-card)",
        borderColor: isConnected ? "rgba(22,163,74,0.25)" : "var(--border-color)",
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: isConnected ? "#16a34a" : "#00c7a8" }} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>Conta Azul</p>
          {caStatus?.connected_at && (
            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              Conectado em {new Date(caStatus.connected_at).toLocaleString("pt-BR")}
            </p>
          )}
        </div>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{ background: badge.bg, color: badge.color }}>
          {badge.label}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 pb-5 border-t space-y-4" style={{ borderColor: "var(--border-color)" }}>
        <div className="pt-4 space-y-3">

          {!caStatus?.env_configured && !loading && (
            <div className="flex items-start gap-2 p-3 rounded-xl text-[11px]"
              style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", color: "#92400e" }}>
              <AlertCircle size={13} className="mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
              <span>Configure <code className="font-mono">CONTA_AZUL_CLIENT_ID</code>, <code className="font-mono">CONTA_AZUL_CLIENT_SECRET</code> e <code className="font-mono">CONTA_AZUL_REDIRECT_URI</code> no <code className="font-mono">.env.local</code> antes de conectar.</span>
            </div>
          )}

          {/* Erro de conexão OAuth — só exibe se último sync não foi sucesso */}
          {(() => {
            const lastSync   = caStatus?.recent_syncs?.[0] ?? null
            const lastSyncOk = lastSync?.status === "success"
            return caStatus?.connection?.error_message && !lastSyncOk && (
              <div className="flex items-start gap-2 p-3 rounded-xl text-[11px]"
                style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>{caStatus.connection.error_message}</span>
              </div>
            )
          })()}

          {feedback && (
            <div className="flex items-start gap-2 p-3 rounded-xl text-[11px]"
              style={{
                background: feedback.kind === "ok" ? "rgba(22,163,74,0.06)" : "rgba(239,68,68,0.06)",
                border: `1px solid ${feedback.kind === "ok" ? "rgba(22,163,74,0.2)" : "rgba(239,68,68,0.2)"}`,
                color: feedback.kind === "ok" ? "#16a34a" : "#ef4444",
              }}>
              {feedback.kind === "ok"
                ? <Check size={12} className="mt-0.5 shrink-0" />
                : <AlertCircle size={12} className="mt-0.5 shrink-0" />}
              <span>{feedback.msg}</span>
            </div>
          )}

          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {isConnected
              ? "Conta Azul conectada via OAuth. Informe o endpoint de vendas, teste e use \"Usar este endpoint\" para ativar a sincronização."
              : "A integração usa OAuth 2.0. Clique em Conectar para autorizar o acesso. Os tokens são armazenados apenas no servidor."}
          </p>

          {/* ── Testador de endpoint ────────────────────────────────────────── */}
          {isConnected && (
            <div className="space-y-2">
              <p className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
                Endpoint de vendas
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={probePath}
                  onChange={e => { setProbePath(e.target.value); setProbeResult(null) }}
                  onKeyDown={e => { if (e.key === "Enter") void handleProbeOne() }}
                  placeholder="/v1/sales"
                  className="flex-1 rounded-xl px-3 py-1.5 text-xs border outline-none font-mono"
                  style={{
                    background:   "var(--bg-app)",
                    borderColor:  "var(--border-color)",
                    color:        "var(--text-primary)",
                  }}
                  disabled={probingPath}
                />
                <button
                  onClick={() => void handleProbeOne()}
                  disabled={probingPath || !probePath.trim()}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40 shrink-0"
                  style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
                >
                  {probingPath
                    ? <><Loader2 size={11} className="animate-spin" /> Testando...</>
                    : "Testar"
                  }
                </button>
              </div>
              <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                Ex: /v1/sales · /v1/financial-events · /v1/finance/receivable-events
              </p>

              {/* Resultado do teste */}
              {probeResult && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border text-[11px]"
                  style={{
                    borderColor: probeResult.ok ? "rgba(22,163,74,0.25)" : probeResult.rate_limited ? "rgba(245,158,11,0.25)" : "rgba(239,68,68,0.2)",
                    background:  probeResult.ok ? "rgba(22,163,74,0.05)" : probeResult.rate_limited ? "rgba(245,158,11,0.05)" : "rgba(239,68,68,0.05)",
                  }}
                >
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded font-semibold"
                    style={{
                      background: probeResult.ok ? "rgba(22,163,74,0.15)" : "rgba(239,68,68,0.1)",
                      color: probeResult.ok ? "#16a34a" : "#ef4444",
                    }}>
                    {probeResult.status || "ERR"}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1">
                    {probeResult.ok ? (
                      <>
                        <p style={{ color: "#16a34a" }}>
                          {probeResult.count !== null ? `${probeResult.count} registros retornados` : "Endpoint respondeu com sucesso"}
                        </p>
                        {probeResult.fields && probeResult.fields.length > 0 && (
                          <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                            Campos: {probeResult.fields.slice(0, 10).join(", ")}
                          </p>
                        )}
                      </>
                    ) : (
                      <p style={{ color: probeResult.rate_limited ? "#f59e0b" : "#ef4444" }}>
                        {probeResult.error}
                      </p>
                    )}
                  </div>
                  {probeResult.ok && (
                    <button
                      onClick={() => void handleSaveEndpoint(probeResult.path)}
                      disabled={savingEndpoint}
                      className="shrink-0 text-[10px] px-2.5 py-1 rounded-lg border transition-all disabled:opacity-50 font-medium"
                      style={{ borderColor: "rgba(22,163,74,0.3)", background: "rgba(22,163,74,0.12)", color: "#16a34a" }}
                    >
                      {savingEndpoint ? <Loader2 size={9} className="animate-spin" /> : "Usar este endpoint"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Endpoint ativo */}
          {caStatus?.saved_endpoint && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-[10px]"
              style={{ background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.15)" }}>
              <Check size={11} style={{ color: "#16a34a" }} className="shrink-0" />
              <span style={{ color: "var(--text-secondary)" }}>
                Ativo: <code className="font-mono" style={{ color: "#16a34a" }}>{caStatus.saved_endpoint}</code>
              </span>
            </div>
          )}

          {/* Status da última sincronização */}
          {(() => {
            const lastSync = caStatus?.recent_syncs?.[0] ?? null
            if (!lastSync || feedback) return null
            if (lastSync.status === "running") {
              return (
                <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <Loader2 size={11} className="animate-spin shrink-0" />
                  Sincronização em andamento...
                </div>
              )
            }
            if (lastSync.status === "success") {
              const msg = lastSync.processed === 0
                ? "Nenhuma venda encontrada no último período sincronizado."
                : `Última sincronização: ${lastSync.inserted} inseridas de ${lastSync.processed} processadas.`
              return (
                <div className="flex items-center gap-2 text-[11px]" style={{ color: "#16a34a" }}>
                  <Check size={11} className="shrink-0" />
                  {msg}
                </div>
              )
            }
            // Último sync com erro
            return (
              <div className="flex items-start gap-2 p-2.5 rounded-xl text-[11px]"
                style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", color: "#ef4444" }}>
                <AlertCircle size={11} className="mt-0.5 shrink-0" />
                <span className="break-words">{lastSync.error_message ?? "Erro na última sincronização"}</span>
              </div>
            )
          })()}

          {/* Histórico recolhível */}
          {caStatus && caStatus.recent_syncs.length > 1 && (
            <div>
              <button
                onClick={() => setShowHistory(v => !v)}
                className="flex items-center gap-1 text-[10px] transition-colors hover:opacity-80"
                style={{ color: "var(--text-muted)" }}
              >
                <span>{showHistory ? "▾" : "▸"}</span>
                Histórico de sincronizações
              </button>
              {showHistory && (
                <div className="mt-2 space-y-1">
                  {caStatus.recent_syncs.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-[10px] py-0.5" style={{ color: "var(--text-muted)" }}>
                      <span>{new Date(s.started_at).toLocaleString("pt-BR")}</span>
                      <span style={{ color: s.status === "success" ? "#16a34a" : s.status === "error" ? "#ef4444" : "#f59e0b" }}>
                        {s.status === "success"
                          ? (s.processed === 0 ? "0 encontradas" : `${s.inserted} inseridas`)
                          : s.status === "running"
                          ? "Em andamento..."
                          : s.error_message?.slice(0, 50) ?? "Erro"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="flex items-center justify-between pt-1">
          <div>
            {isConnected && (
              <button
                onClick={() => void handleDisconnect()}
                disabled={disconnecting || syncing}
                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl border transition-colors hover:bg-red-500/10 hover:border-red-500/30 disabled:opacity-40"
                style={{ borderColor: "var(--border-color)", color: "#ef4444" }}
              >
                {disconnecting
                  ? <><Loader2 size={11} className="animate-spin" /> Desconectando...</>
                  : <><Link2Off size={11} /> Desconectar</>
                }
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isConnected ? (
              <>
                <a
                  href="/api/integrations/conta-azul/connect"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
                >
                  <Link2 size={11} /> Reconectar
                </a>
                <button
                  onClick={() => void handleSync()}
                  disabled={syncing || disconnecting}
                  className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-xl font-semibold text-white transition-all disabled:opacity-60 bg-mota-600 hover:bg-mota-700"
                >
                  {syncing
                    ? <><Loader2 size={11} className="animate-spin" /> Sincronizando...</>
                    : <><RefreshCw size={11} /> Sincronizar</>
                  }
                </button>
              </>
            ) : (
              <a
                href="/api/integrations/conta-azul/connect"
                className={cn(
                  "flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-xl font-semibold text-white transition-all bg-mota-600 hover:bg-mota-700",
                  !caStatus?.env_configured && "opacity-50 pointer-events-none",
                )}
              >
                <Link2 size={11} /> Conectar
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── APIs ─── */

interface FieldDef {
  key:          string
  label:        string
  secret:       boolean
  placeholder?: string
}

const APIS_CONFIG: Array<{
  id:      string
  label:   string
  color:   string
  fields:  FieldDef[]
  pending: boolean
}> = [
  {
    id: "anthropic", label: "Anthropic (Claude)", color: "#f97316", pending: false,
    fields: [{ key: "api_key", label: "API Key", secret: true, placeholder: "sk-ant-api03-..." }],
  },
  {
    id: "openai", label: "OpenAI", color: "#16a34a", pending: false,
    fields: [{ key: "api_key", label: "API Key", secret: true, placeholder: "sk-proj-..." }],
  },
  {
    id: "gemini", label: "Google Gemini", color: "#4285f4", pending: false,
    fields: [{ key: "api_key", label: "API Key", secret: true, placeholder: "AIzaSy..." }],
  },
  {
    id: "supabase", label: "Supabase", color: "#3ecf8e", pending: false,
    fields: [],
  },
  {
    id: "rocketchat", label: "Rocket.Chat", color: "#f5455c", pending: false,
    fields: [], // renderizado via RocketChatConfigFields
  },
  {
    id: "meta_ads", label: "Meta Ads", color: "#1877f2", pending: true,
    fields: [{ key: "access_token", label: "Access Token", secret: true, placeholder: "EAAx..." }],
  },
  {
    id: "google_ads", label: "Google Ads", color: "#fbbc04", pending: true,
    fields: [{ key: "developer_token", label: "Developer Token", secret: true }],
  },
  {
    id: "ga4", label: "Google Analytics 4", color: "#ef4444", pending: true,
    fields: [{ key: "api_key", label: "API Key", secret: true, placeholder: "AIzaSy..." }],
  },
  {
    id: "reportei", label: "Reportei", color: "#8b5cf6", pending: true,
    fields: [{ key: "api_key", label: "API Key", secret: true, placeholder: "rpt_..." }],
  },
  {
    id: "whatsapp", label: "WhatsApp Business", color: "#25d366", pending: true,
    fields: [{ key: "token", label: "Token", secret: true }],
  },
  {
    id: "google_drive", label: "Google Drive", color: "#4285f4", pending: true,
    fields: [{ key: "api_key", label: "API Key", secret: true, placeholder: "AIzaSy..." }],
  },
]

interface ApiConnUI {
  id:             string | null
  provider:       string
  status:         string
  config:         Record<string, string>
  last_tested_at: string | null
  error_message:  string | null
  updated_at:     string | null
}

function getStatusInfo(status: string) {
  switch (status) {
    case "not_configured": return { label: "Não configurado", color: "#94a3b8", bg: "rgba(148,163,184,0.1)" }
    case "configured":     return { label: "Configurado",     color: "#3b82f6", bg: "rgba(59,130,246,0.1)"  }
    case "connected":      return { label: "Conectado",       color: "#16a34a", bg: "rgba(22,163,74,0.1)"   }
    case "error":          return { label: "Erro",            color: "#ef4444", bg: "rgba(239,68,68,0.1)"   }
    default:               return { label: "Desconectado",    color: "#94a3b8", bg: "rgba(148,163,184,0.1)" }
  }
}

function RocketChatConfigFields({
  conn, getDraft, setDraft, isMasked,
}: {
  conn?:    ApiConnUI
  getDraft: (key: string) => string | undefined
  setDraft: (key: string, val: string) => void
  isMasked: (v: string | undefined) => boolean
}) {
  const rcMode = getDraft("mode") ?? conn?.config?.mode ?? "rest"

  const restFields: FieldDef[] = [
    { key: "url",             label: "URL do servidor",     secret: false, placeholder: "https://chat.empresa.com" },
    { key: "user_id",         label: "User ID",              secret: false, placeholder: "abc123..." },
    { key: "auth_token",      label: "Auth Token",           secret: true,  placeholder: "token..." },
    { key: "default_channel", label: "Canal padrão",         secret: false, placeholder: "#geral" },
    { key: "bot_username",    label: "Username do bot",      secret: false, placeholder: "mota-bot" },
  ]

  const webhookFields: FieldDef[] = [
    { key: "webhook_url",     label: "Webhook URL",          secret: true,  placeholder: "https://chat.empresa.com/hooks/..." },
    { key: "default_channel", label: "Canal padrão",         secret: false, placeholder: "#geral ou ID da sala" },
    { key: "alias",           label: "Alias / Nome exibido", secret: false, placeholder: "Jarvis" },
  ]

  const activeFields = rcMode === "webhook" ? webhookFields : restFields

  return (
    <>
      <Field label="Modo de conexão">
        <select
          value={rcMode}
          onChange={(e) => setDraft("mode", e.target.value)}
          className="w-full rounded-xl px-3 py-2.5 text-xs border outline-none focus:border-mota-500"
          style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
        >
          <option value="rest">REST API</option>
          <option value="webhook">Incoming Webhook</option>
        </select>
      </Field>
      {activeFields.map((field) => {
        const draftVal  = getDraft(field.key)
        const serverVal = conn?.config?.[field.key]
        const hasMask   = isMasked(serverVal) && draftVal === undefined
        return (
          <Field key={field.key} label={field.label}>
            {hasMask ? (
              <>
                <div className="flex items-center gap-2">
                  <div
                    className="flex-1 rounded-xl px-3 py-2.5 text-xs font-mono border"
                    style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-muted)" }}
                  >
                    {serverVal}
                  </div>
                  <button
                    onClick={() => setDraft(field.key, "")}
                    className="shrink-0 text-xs px-3 py-2.5 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
                  >
                    Alterar
                  </button>
                </div>
                <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
                  Já salvo. Clique em Alterar apenas para substituir.
                </p>
              </>
            ) : (
              <input
                type={field.secret ? "password" : "text"}
                value={draftVal ?? serverVal ?? ""}
                onChange={(e) => setDraft(field.key, e.target.value)}
                placeholder={field.placeholder ?? ""}
                autoComplete="off"
                className="w-full rounded-xl px-3 py-2.5 text-xs border outline-none placeholder:text-[var(--text-muted)] focus:border-mota-500"
                style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
              />
            )}
          </Field>
        )
      })}
    </>
  )
}

function ApisTab() {
  const [connections, setConnections] = useState<ApiConnUI[]>([])
  const [expanded,    setExpanded]    = useState<string | null>(null)
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, Record<string, string>>>({})
  const [saving,      setSaving]      = useState<string | null>(null)
  const [testing,     setTesting]     = useState<string | null>(null)
  const [feedback,    setFeedback]    = useState<Record<string, { kind: "ok" | "error"; msg?: string } | null>>({})
  const [loading,     setLoading]     = useState(true)
  const [fetchErr,    setFetchErr]    = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/api-connections")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<ApiConnUI[]>
      })
      .then(setConnections)
      .catch((e: Error) => setFetchErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  function getDraftField(provider: string, key: string): string | undefined {
    return fieldDrafts[provider]?.[key]
  }

  function setDraftField(provider: string, key: string, value: string) {
    setFieldDrafts((prev) => ({
      ...prev,
      [provider]: { ...(prev[provider] ?? {}), [key]: value },
    }))
  }

  function cancelDrafts(provider: string) {
    setFieldDrafts((prev) => { const n = { ...prev }; delete n[provider]; return n })
  }

  function isMasked(v: string | undefined): boolean {
    return typeof v === "string" && v.startsWith("****")
  }

  async function handleSave(provider: string) {
    const drafts = fieldDrafts[provider] ?? {}
    setSaving(provider)
    setFeedback((prev) => ({ ...prev, [provider]: null }))
    try {
      const configToSend: Record<string, string> = {}
      for (const [k, v] of Object.entries(drafts)) {
        if (v.trim() && !v.startsWith("****")) configToSend[k] = v.trim()
      }
      const res  = await fetch("/api/api-connections", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ provider, config: configToSend }),
      })
      const json = await res.json() as { ok?: boolean; status?: string; updated_at?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar")
      setConnections((prev) =>
        prev.map((c) =>
          c.provider === provider
            ? { ...c, status: json.status ?? "configured", updated_at: json.updated_at ?? c.updated_at }
            : c
        )
      )
      cancelDrafts(provider)
      setFeedback((prev) => ({ ...prev, [provider]: { kind: "ok" } }))
      setTimeout(() => setFeedback((prev) => ({ ...prev, [provider]: null })), 2500)
      // Re-sync do config para garantir que mode e campos não-mascarados estejam atualizados
      fetch("/api/api-connections")
        .then((r) => r.json() as Promise<ApiConnUI[]>)
        .then(setConnections)
        .catch(() => {})
    } catch (err: unknown) {
      setFeedback((prev) => ({
        ...prev,
        [provider]: { kind: "error", msg: err instanceof Error ? err.message : "Erro" },
      }))
    } finally {
      setSaving(null)
    }
  }

  async function handleTest(provider: string) {
    setTesting(provider)
    setFeedback((prev) => ({ ...prev, [provider]: null }))
    try {
      const res  = await fetch("/api/api-connections/test", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ provider }),
      })
      const json = await res.json() as { ok: boolean; pending?: boolean; status: string; message?: string }
      if (!res.ok) throw new Error(json.message ?? "Erro ao testar")
      setConnections((prev) =>
        prev.map((c) =>
          c.provider === provider
            ? { ...c, status: json.status, error_message: json.ok ? null : (json.message ?? null) }
            : c
        )
      )
      if (json.ok || json.pending) {
        setFeedback((prev) => ({ ...prev, [provider]: { kind: "ok", msg: json.pending ? "Pendente" : "Conectado" } }))
      } else {
        setFeedback((prev) => ({ ...prev, [provider]: { kind: "error", msg: json.message } }))
      }
      setTimeout(() => setFeedback((prev) => ({ ...prev, [provider]: null })), 3000)
    } catch (err: unknown) {
      setFeedback((prev) => ({
        ...prev,
        [provider]: { kind: "error", msg: err instanceof Error ? err.message : "Erro" },
      }))
    } finally {
      setTesting(null)
    }
  }

  async function handleDelete(provider: string) {
    const res = await fetch("/api/api-connections", {
      method:  "DELETE",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ provider }),
    })
    if (res.ok) {
      setConnections((prev) =>
        prev.map((c) =>
          c.provider === provider
            ? { ...c, id: null, status: "not_configured", config: {}, error_message: null }
            : c
        )
      )
      cancelDrafts(provider)
      if (expanded === provider) setExpanded(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
    </div>
  )

  if (fetchErr) return (
    <div className="py-8 text-center space-y-2">
      <p className="text-xs" style={{ color: "#ef4444" }}>Erro ao carregar conexões: {fetchErr}</p>
      <button
        onClick={() => {
          setFetchErr(null); setLoading(true)
          fetch("/api/api-connections").then((r) => r.json() as Promise<ApiConnUI[]>).then(setConnections).catch((e: Error) => setFetchErr(e.message)).finally(() => setLoading(false))
        }}
        className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)]"
        style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
      >
        Tentar novamente
      </button>
    </div>
  )

  return (
    <div className="space-y-4">
      <SectionTitle>Integrações de API</SectionTitle>
      <p className="text-[11px] -mt-2" style={{ color: "var(--text-muted)" }}>
        Configure as chaves de API para os provedores usados pelos agentes e automações.
      </p>
      <div
        className="flex items-start gap-2 p-3 rounded-xl text-[11px]"
        style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", color: "#92400e" }}
      >
        <AlertCircle size={13} className="mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
        <span>Vault/criptografia em breve. As chaves são armazenadas em JSONB no banco de dados.</span>
      </div>

      <ContaAzulCard />

      <div className="space-y-2">
        {APIS_CONFIG.map((def) => {
          const conn      = connections.find((c) => c.provider === def.id)
          const status    = conn?.status ?? "not_configured"
          const si        = getStatusInfo(status)
          const isOpen    = expanded === def.id
          const isSaving  = saving  === def.id
          const isTesting = testing === def.id
          const fb        = feedback[def.id]
          const hasDraft  = Object.keys(fieldDrafts[def.id] ?? {}).length > 0

          return (
            <div
              key={def.id}
              className="rounded-2xl border overflow-hidden"
              style={{
                background:  "var(--bg-card)",
                borderColor: isOpen ? "var(--border-active, #16a34a44)" : "var(--border-color)",
              }}
            >
              {/* Cabeçalho clicável */}
              <button
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
                onClick={() => setExpanded(isOpen ? null : def.id)}
              >
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: def.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                    {def.label}
                    {hasDraft && (
                      <span className="ml-2 text-[10px] font-normal" style={{ color: "#f59e0b" }}>
                        • não salvo
                      </span>
                    )}
                  </p>
                  {conn?.last_tested_at && (
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                      Testado em {new Date(conn.last_tested_at).toLocaleString("pt-BR")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {fb?.kind === "ok" && (
                    <span className="text-[10px] flex items-center gap-0.5" style={{ color: "#16a34a" }}>
                      <Check size={10} /> {fb.msg ?? "Salvo"}
                    </span>
                  )}
                  {fb?.kind === "error" && (
                    <span className="text-[10px]" style={{ color: "#ef4444" }}>Erro</span>
                  )}
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: si.bg, color: si.color }}
                  >
                    {si.label}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {isOpen ? "▲" : "▼"}
                  </span>
                </div>
              </button>

              {/* Formulário expandido */}
              {isOpen && (
                <div className="px-4 pb-5 space-y-4 border-t" style={{ borderColor: "var(--border-color)" }}>
                  <div className="pt-4 space-y-3">

                    {/* Supabase: caso especial — env vars */}
                    {def.id === "supabase" && (
                      <div
                        className="flex items-start gap-2 p-3 rounded-xl text-[11px]"
                        style={{ background: "rgba(62,207,142,0.06)", border: "1px solid rgba(62,207,142,0.2)", color: "var(--text-secondary)" }}
                      >
                        <Database size={13} className="mt-0.5 shrink-0" style={{ color: "#3ecf8e" }} />
                        <span>
                          As credenciais do Supabase são lidas via variáveis de ambiente
                          (<code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
                          <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code>),
                          não via configuração manual. Clique em Testar para verificar a conectividade.
                        </span>
                      </div>
                    )}

                    {/* Rocket.Chat: seletor de modo + campos condicionais + destinos */}
                    {def.id === "rocketchat" && (
                      <>
                        <RocketChatConfigFields
                          conn={conn}
                          getDraft={(key) => getDraftField(def.id, key)}
                          setDraft={(key, val) => setDraftField(def.id, key, val)}
                          isMasked={isMasked}
                        />
                        <div
                          className="border-t pt-4 -mx-4 px-4"
                          style={{ borderColor: "var(--border-color)" }}
                        >
                          <RocketChatDestinations />
                        </div>
                      </>
                    )}

                    {/* Campos de configuração (provedores padrão) */}
                    {def.fields.map((field) => {
                      const draftVal  = getDraftField(def.id, field.key)
                      const serverVal = conn?.config?.[field.key]
                      const hasMasked = isMasked(serverVal) && draftVal === undefined

                      return (
                        <Field key={field.key} label={field.label}>
                          {hasMasked ? (
                            <div className="flex items-center gap-2">
                              <div
                                className="flex-1 rounded-xl px-3 py-2.5 text-xs font-mono border"
                                style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-muted)" }}
                              >
                                {serverVal}
                              </div>
                              <button
                                onClick={() => setDraftField(def.id, field.key, "")}
                                className="shrink-0 text-xs px-3 py-2.5 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]"
                                style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
                              >
                                Alterar
                              </button>
                            </div>
                          ) : (
                            <input
                              type={field.secret ? "password" : "text"}
                              value={draftVal ?? ""}
                              onChange={(e) => setDraftField(def.id, field.key, e.target.value)}
                              placeholder={field.placeholder ?? ""}
                              autoComplete="off"
                              className="w-full rounded-xl px-3 py-2.5 text-xs border outline-none placeholder:text-[var(--text-muted)] focus:border-mota-500"
                              style={{ background: "var(--bg-input)", borderColor: "var(--border-color)", color: "var(--text-primary)" }}
                            />
                          )}
                        </Field>
                      )
                    })}

                    {/* Nota para provedores pendentes */}
                    {def.pending && (
                      <div
                        className="flex items-start gap-2 p-3 rounded-xl text-[11px]"
                        style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)", color: "var(--text-secondary)" }}
                      >
                        <AlertCircle size={12} className="mt-0.5 shrink-0" style={{ color: "#3b82f6" }} />
                        <span>Integração em desenvolvimento. Salve a chave agora — o teste real será implementado em breve.</span>
                      </div>
                    )}

                    {/* Erro do último teste */}
                    {status === "error" && conn?.error_message && (
                      <div
                        className="flex items-start gap-2 p-3 rounded-xl text-[11px]"
                        style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}
                      >
                        <AlertCircle size={12} className="mt-0.5 shrink-0" />
                        <span>{conn.error_message}</span>
                      </div>
                    )}

                    {fb?.kind === "error" && fb.msg && (
                      <p className="text-[11px]" style={{ color: "#ef4444" }}>{fb.msg}</p>
                    )}
                  </div>

                  {/* Botões de ação */}
                  <div className="flex items-center justify-between pt-1">
                    <div>
                      {conn?.id && (
                        <button
                          onClick={() => handleDelete(def.id)}
                          disabled={isSaving || isTesting}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl border transition-colors hover:bg-red-500/10 hover:border-red-500/30 disabled:opacity-40"
                          style={{ borderColor: "var(--border-color)", color: "#ef4444" }}
                        >
                          <Trash2 size={11} /> Remover
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTest(def.id)}
                        disabled={isTesting || isSaving || (!conn?.id && def.id !== "supabase")}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
                        style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
                      >
                        {isTesting
                          ? <><Loader2 size={11} className="animate-spin" /> Testando...</>
                          : <><RefreshCw size={11} /> Testar</>
                        }
                      </button>

                      {def.id !== "supabase" && (
                        <button
                          onClick={() => handleSave(def.id)}
                          disabled={isSaving || isTesting}
                          className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-xl font-semibold text-white transition-all disabled:opacity-60 bg-mota-600 hover:bg-mota-700"
                        >
                          {isSaving
                            ? <><Loader2 size={11} className="animate-spin" /> Salvando...</>
                            : "Salvar"
                          }
                        </button>
                      )}
                    </div>
                  </div>

                  {conn?.updated_at && (
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      Última atualização: {new Date(conn.updated_at).toLocaleString("pt-BR")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Supabase ─── */
function SupabaseTab() {
  return (
    <div className="space-y-5">
      <SectionTitle>Conexão Supabase</SectionTitle>
      <div
        className="flex items-start gap-3 p-4 rounded-xl border"
        style={{ background: "rgba(59,130,246,0.06)", borderColor: "rgba(59,130,246,0.2)" }}
      >
        <Database size={15} className="text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Configure a conexão com seu projeto Supabase. As credenciais são usadas para persistir sessões, agentes, tarefas e automações.
        </p>
      </div>

      <div className="space-y-4">
        <Field label="URL do projeto" hint="Exemplo: https://xxxx.supabase.co">
          <Input placeholder="https://seu-projeto.supabase.co" />
        </Field>
        <Field label="Chave anônima (anon key)" hint="Chave pública — segura para uso no cliente.">
          <Input placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." />
        </Field>
        <Field label="Chave de serviço (service_role)" hint="Chave privada — nunca exponha ao cliente.">
          <Input type="password" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." />
        </Field>
        <Field label="Schema padrão">
          <Input defaultValue="public" />
        </Field>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          className="text-xs px-4 py-2 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]"
          style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
        >
          Testar conexão
        </button>
        <SaveButton label="Salvar credenciais" />
      </div>
    </div>
  )
}

/* ─── Appearance ─── */
function AppearanceTab() {
  const { theme, set } = useThemeContext()
  const [language, setLanguage] = useState("Português (BR)")
  const [sidebarDefault, setSidebarDefault] = useState("Expandido")

  const themeOptions = [
    { id: "light" as const, label: "Claro",     icon: Sun     },
    { id: "dark"  as const, label: "Escuro",    icon: Moon    },
    { id: "system" as const, label: "Sistema",  icon: Monitor },
  ]

  return (
    <div className="space-y-6">
      <SectionTitle>Aparência</SectionTitle>

      <div className="space-y-2">
        <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Tema</p>
        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map((opt) => {
            const isActive = opt.id !== "system" && theme === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => opt.id !== "system" && set(opt.id)}
                className={cn(
                  "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                  isActive
                    ? "border-mota-500 bg-mota-500/10"
                    : "hover:border-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
                )}
                style={{ borderColor: isActive ? undefined : "var(--border-color)" }}
              >
                <opt.icon size={18} style={{ color: isActive ? "#16a34a" : "var(--text-muted)" }} />
                <span className="text-xs font-medium" style={{ color: isActive ? "var(--text-primary)" : "var(--text-muted)" }}>
                  {opt.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <Divider />

      <div className="space-y-4">
        <Field label="Idioma">
          <Select
            options={["Português (BR)", "English (US)", "Español"]}
            value={language}
            onChange={setLanguage}
          />
        </Field>
        <Field label="Sidebar padrão">
          <Select
            options={["Expandido", "Recolhido"]}
            value={sidebarDefault}
            onChange={setSidebarDefault}
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <SaveButton />
      </div>
    </div>
  )
}

/* ─── Security ─── */

// ── Shared helpers ──────────────────────────────────────────────────────────

function getDeviceFingerprint(): string {
  if (typeof window === "undefined") return ""
  let fp = localStorage.getItem("mota_device_fp")
  if (!fp) {
    fp = crypto.randomUUID()
    localStorage.setItem("mota_device_fp", fp)
  }
  return fp
}

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0
  if (pw.length >= 8)                          score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw))   score++
  if (/[0-9]/.test(pw))                        score++
  if (/[^a-zA-Z0-9]/.test(pw))                score++
  const levels = [
    { label: "Muito fraca", color: "#ef4444" },
    { label: "Fraca",       color: "#f97316" },
    { label: "Moderada",    color: "#f59e0b" },
    { label: "Forte",       color: "#16a34a" },
    { label: "Muito forte", color: "#059669" },
  ]
  return { score, ...levels[Math.min(score, 4)] }
}

// ── Password section ─────────────────────────────────────────────────────────

function PasswordSection() {
  const [newPw,   setNewPw]   = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const strength = newPw ? passwordStrength(newPw) : null

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    if (loading) return
    if (newPw !== confirm) { setError("As senhas não coincidem."); return }
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch("/api/auth/change-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ new_password: newPw, confirm_password: confirm }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) { setError(data.error ?? "Erro ao alterar senha"); return }
      setSuccess(true)
      setNewPw("")
      setConfirm("")
      setTimeout(() => setSuccess(false), 4000)
    } catch {
      setError("Erro de conexão. Tente novamente.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div>
        <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Alterar senha</p>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          Mínimo 8 caracteres, incluindo uma letra e um número. Sua sessão ativa é necessária.
        </p>
      </div>

      <Field label="Nova senha">
        <Input
          type="password"
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          placeholder="Mínimo 8 caracteres"
          autoComplete="new-password"
          required
        />
        {strength && newPw.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-1 flex-1 rounded-full transition-colors"
                  style={{ background: i < strength.score ? strength.color : "var(--border-color)" }}
                />
              ))}
            </div>
            <p className="text-[10px]" style={{ color: strength.color }}>{strength.label}</p>
          </div>
        )}
      </Field>

      <Field label="Confirmar nova senha">
        <Input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repita a nova senha"
          autoComplete="new-password"
          required
        />
        {confirm && newPw !== confirm && (
          <p className="text-[11px] mt-1" style={{ color: "#ef4444" }}>As senhas não coincidem.</p>
        )}
      </Field>

      {error && (
        <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
          {error}
        </p>
      )}

      {success && (
        <p className="text-xs px-3 py-2 rounded-xl flex items-center gap-1.5" style={{ background: "rgba(22,163,74,0.08)", color: "#16a34a" }}>
          <Check size={12} /> Senha alterada com sucesso!
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !newPw || !confirm || newPw !== confirm}
        className="flex items-center gap-2 text-xs px-5 py-2.5 rounded-xl font-semibold text-white transition-all bg-mota-600 hover:bg-mota-700 disabled:opacity-50"
      >
        {loading ? <><Loader2 size={12} className="animate-spin" /> Alterando...</> : "Alterar senha"}
      </button>
    </form>
  )
}

// ── MFA section ──────────────────────────────────────────────────────────────

type MfaFactor = { id: string; factor_type: string; status: string; friendly_name?: string | null }

function MfaSection() {
  const [factors,      setFactors]      = useState<MfaFactor[] | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [enrolling,    setEnrolling]    = useState(false)
  const [qrCode,       setQrCode]       = useState<string | null>(null)
  const [secret,       setSecret]       = useState<string | null>(null)
  const [factorId,     setFactorId]     = useState<string | null>(null)
  const [code,         setCode]         = useState("")
  const [verifying,    setVerifying]    = useState(false)
  const [unenrolling,  setUnenrolling]  = useState(false)
  const [mfaUnavailable, setMfaUnavail] = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [successMsg,   setSuccessMsg]   = useState<string | null>(null)

  useEffect(() => { void loadFactors() }, [])

  async function loadFactors() {
    setLoading(true)
    setError(null)
    try {
      const supabase = createBrowserClient()
      const { data, error: mfaErr } = await supabase.auth.mfa.listFactors()
      if (mfaErr) {
        setMfaUnavail(true)
        setFactors([])
      } else {
        setFactors(data?.all ?? [])
      }
    } catch {
      setMfaUnavail(true)
      setFactors([])
    } finally {
      setLoading(false)
    }
  }

  async function handleEnroll() {
    setEnrolling(true)
    setError(null)
    try {
      const supabase = createBrowserClient()
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: "totp" })
      if (err) { setError(err.message); return }
      setQrCode(data.totp.qr_code)
      setSecret(data.totp.secret)
      setFactorId(data.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao iniciar configuração do 2FA")
    } finally {
      setEnrolling(false)
    }
  }

  async function handleVerify() {
    if (!factorId || code.length !== 6) return
    setVerifying(true)
    setError(null)
    try {
      const supabase = createBrowserClient()
      const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
      if (err) { setError(err.message.includes("Invalid") ? "Código inválido. Verifique seu aplicativo e tente novamente." : err.message); return }
      setSuccessMsg("2FA ativado com sucesso!")
      setQrCode(null); setSecret(null); setFactorId(null); setCode("")
      setTimeout(() => setSuccessMsg(null), 4000)
      await loadFactors()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Código inválido")
    } finally {
      setVerifying(false)
    }
  }

  async function handleUnenroll(id: string) {
    if (!window.confirm("Tem certeza que deseja desativar o 2FA?")) return
    setUnenrolling(true)
    setError(null)
    try {
      const supabase = createBrowserClient()
      const { error: err } = await supabase.auth.mfa.unenroll({ factorId: id })
      if (err) { setError(err.message); return }
      setSuccessMsg("2FA desativado.")
      setTimeout(() => setSuccessMsg(null), 4000)
      await loadFactors()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao desativar 2FA")
    } finally {
      setUnenrolling(false)
    }
  }

  const verifiedFactors = (factors ?? []).filter((f) => f.status === "verified")

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Autenticação em dois fatores (2FA)</p>
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          Proteja sua conta com um código gerado por aplicativo autenticador (Google Authenticator, Authy, etc.).
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2">
          <Loader2 size={13} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Verificando status do 2FA...</span>
        </div>
      )}

      {!loading && mfaUnavailable && (
        <div
          className="flex items-start gap-2 p-3 rounded-xl"
          style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}
        >
          <AlertCircle size={13} className="mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            2FA não disponível neste projeto Supabase ou requer configuração adicional.
            Verifique se MFA está habilitado no painel do Supabase em <strong>Auth &gt; Settings</strong>.
          </p>
        </div>
      )}

      {!loading && !mfaUnavailable && (
        <>
          {/* Fator ativo */}
          {verifiedFactors.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between p-4 rounded-xl border"
              style={{ background: "var(--bg-card)", borderColor: "rgba(22,163,74,0.3)" }}
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "rgba(22,163,74,0.12)" }}>
                  <ShieldCheck size={14} style={{ color: "#16a34a" }} />
                </div>
                <div>
                  <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>TOTP ativo</p>
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Código de 6 dígitos pelo aplicativo</p>
                </div>
              </div>
              <button
                onClick={() => void handleUnenroll(f.id)}
                disabled={unenrolling}
                className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border transition-colors hover:bg-red-500/10 disabled:opacity-50"
                style={{ borderColor: "rgba(239,68,68,0.3)", color: "#ef4444" }}
              >
                {unenrolling ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                Desativar
              </button>
            </div>
          ))}

          {/* Sem fator → botão ativar */}
          {verifiedFactors.length === 0 && !qrCode && (
            <button
              onClick={() => void handleEnroll()}
              disabled={enrolling}
              className="flex items-center gap-2 text-xs px-4 py-2.5 rounded-xl border font-medium transition-all hover:bg-[var(--bg-hover)] disabled:opacity-50"
              style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}
            >
              {enrolling ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={13} />}
              {enrolling ? "Iniciando..." : "Ativar 2FA"}
            </button>
          )}

          {/* Fluxo de enrollment: QR Code + verificação */}
          {qrCode && (
            <div
              className="space-y-4 p-4 rounded-xl border"
              style={{ background: "var(--bg-card)", borderColor: "var(--border-color)" }}
            >
              <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                Configure seu aplicativo autenticador
              </p>
              <ol className="text-[11px] space-y-1 list-decimal list-inside" style={{ color: "var(--text-muted)" }}>
                <li>Abra Google Authenticator, Authy ou similar</li>
                <li>Escaneie o QR Code abaixo ou insira o código manualmente</li>
                <li>Digite o código de 6 dígitos gerado pelo aplicativo</li>
              </ol>
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrCode}
                  alt="QR Code 2FA"
                  className="w-44 h-44 rounded-xl border"
                  style={{ borderColor: "var(--border-color)" }}
                />
                {secret && (
                  <div className="text-center space-y-1 w-full">
                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Código manual:</p>
                    <code
                      className="block text-xs font-mono px-3 py-2 rounded-xl text-center select-all break-all"
                      style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}
                    >
                      {secret}
                    </code>
                  </div>
                )}
              </div>
              <Field label="Código de verificação (6 dígitos)">
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  autoComplete="one-time-code"
                />
              </Field>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setQrCode(null); setSecret(null); setFactorId(null); setCode(""); setError(null) }}
                  className="text-xs px-3 py-1.5 rounded-xl border transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void handleVerify()}
                  disabled={verifying || code.length !== 6}
                  className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded-xl font-semibold text-white bg-mota-600 hover:bg-mota-700 disabled:opacity-50 transition-all"
                >
                  {verifying ? <><Loader2 size={11} className="animate-spin" /> Verificando...</> : "Verificar e ativar"}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
              {error}
            </p>
          )}
          {successMsg && (
            <p className="text-xs px-3 py-2 rounded-xl flex items-center gap-1.5" style={{ background: "rgba(22,163,74,0.08)", color: "#16a34a" }}>
              <Check size={12} /> {successMsg}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── Sessions section ─────────────────────────────────────────────────────────

interface UserSession {
  id:           string
  ip_address:   string | null
  device_name:  string | null
  last_seen_at: string
  revoked_at:   string | null
  is_current:   boolean
}

function SessionsSection() {
  const [sessions,   setSessions]   = useState<UserSession[]>([])
  const [loading,    setLoading]    = useState(true)
  const [revoking,   setRevoking]   = useState<string | null>(null)
  const [error,      setError]      = useState<string | null>(null)
  const [revokeNote, setRevokeNote] = useState<string | null>(null)

  useEffect(() => { void loadSessions() }, [])

  async function loadSessions() {
    setLoading(true)
    setError(null)
    try {
      const fp  = getDeviceFingerprint()
      const res = await fetch(`/api/auth/sessions?fingerprint=${encodeURIComponent(fp)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { sessions: UserSession[] }
      setSessions(data.sessions)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar sessões")
    } finally {
      setLoading(false)
    }
  }

  async function handleRevoke(id: string) {
    setRevoking(id)
    setRevokeNote(null)
    try {
      const res  = await fetch("/api/auth/sessions", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id }),
      })
      const data = await res.json() as { ok?: boolean; note?: string; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Erro ao revogar")
      if (data.note) setRevokeNote(data.note)
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao revogar sessão")
    } finally {
      setRevoking(null)
    }
  }

  function formatRelative(ts: string): string {
    const diff  = Date.now() - new Date(ts).getTime()
    const mins  = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days  = Math.floor(diff / 86400000)
    if (mins < 2)   return "agora"
    if (mins < 60)  return `há ${mins}min`
    if (hours < 24) return `há ${hours}h`
    return `há ${days} dia${days !== 1 ? "s" : ""}`
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>Sessões ativas</p>
        <button
          onClick={() => void loadSessions()}
          disabled={loading}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
          style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
        >
          <RefreshCw size={10} className={loading ? "animate-spin" : ""} />
          Recarregar
        </button>
      </div>

      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        Dispositivos onde você acessou o Jarvis recentemente. Revogar remove o registro — a expiração do token JWT depende do Supabase Auth.
      </p>

      {revokeNote && (
        <div
          className="flex items-start gap-2 p-3 rounded-xl text-[11px]"
          style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", color: "#92400e" }}
        >
          <AlertCircle size={12} className="mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
          <span>{revokeNote}</span>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-3">
          <Loader2 size={13} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Carregando sessões...</span>
        </div>
      )}

      {error && !loading && (
        <p className="text-[11px]" style={{ color: "#ef4444" }}>Erro: {error}</p>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="py-6 text-center rounded-xl border" style={{ borderColor: "var(--border-color)" }}>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Nenhuma sessão registrada ainda. Acessos futuros serão listados aqui automaticamente.
          </p>
        </div>
      )}

      {sessions.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-3 p-4 rounded-xl border"
          style={{
            background:  "var(--bg-card)",
            borderColor: s.is_current ? "rgba(22,163,74,0.3)" : "var(--border-color)",
          }}
        >
          <Monitor size={16} className="shrink-0" style={{ color: "var(--text-muted)" }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                {s.device_name ?? "Dispositivo desconhecido"}
              </p>
              {s.is_current && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-mota-500/10 text-mota-500 font-medium shrink-0">
                  Esta sessão
                </span>
              )}
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              {s.ip_address ? `${s.ip_address} · ` : ""}
              {formatRelative(s.last_seen_at)}
            </p>
          </div>
          {!s.is_current && (
            <button
              onClick={() => void handleRevoke(s.id)}
              disabled={revoking === s.id}
              className="p-1.5 rounded-lg transition-colors hover:bg-red-500/10 disabled:opacity-40 shrink-0"
              style={{ color: "#ef4444" }}
              title="Encerrar sessão"
            >
              {revoking === s.id
                ? <Loader2 size={13} className="animate-spin" />
                : <LogOut size={13} />
              }
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── SecurityTab ──────────────────────────────────────────────────────────────

function SecurityTab() {
  return (
    <div className="space-y-6">
      <SectionTitle>Segurança</SectionTitle>
      <PasswordSection />
      <Divider />
      <MfaSection />
      <Divider />
      <SessionsSection />
    </div>
  )
}

/* ─── Logs ─── */

const EVENT_TYPE_COLORS: Record<string, string> = {
  chat:     "#16a34a",
  workflow: "#8b5cf6",
  auto:     "#3b82f6",
  source:   "#06b6d4",
  watcher:  "#f97316",
  auth:     "#94a3b8",
  settings: "#10b981",
  api:      "#f59e0b",
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  chat:     "Chat",
  workflow: "Workflow",
  auto:     "Automação",
  source:   "Fonte",
  watcher:  "Vigia",
  auth:     "Auth",
  settings: "Config",
  api:      "API",
}

interface LogEntry {
  id:         string
  user_id:    string | null
  user_email: string | null
  user_name:  string | null
  event_type: string
  action:     string
  detail:     string
  metadata:   Record<string, unknown>
  company_id: string | null
  session_id: string | null
  created_at: string
}

function LogsTab() {
  const [logs,    setLogs]    = useState<LogEntry[]>([])
  const [filter,  setFilter]  = useState("")
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  function load(eventType?: string) {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: "50" })
    if (eventType) params.set("event_type", eventType)
    fetch(`/api/activity-logs?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ logs: LogEntry[]; is_admin: boolean }>
      })
      .then(({ logs: data, is_admin }) => { setLogs(data); setIsAdmin(is_admin) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function handleFilter(type: string) {
    setFilter(type)
    load(type || undefined)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <SectionTitle>Log de atividades</SectionTitle>
        <button
          onClick={() => load(filter || undefined)}
          disabled={loading}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
          style={{ borderColor: "var(--border-color)", color: "var(--text-muted)" }}
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          Recarregar
        </button>
      </div>

      {/* Filtro por tipo */}
      <div className="flex flex-wrap gap-1.5">
        {["", ...Object.keys(EVENT_TYPE_LABELS)].map((type) => (
          <button
            key={type}
            onClick={() => handleFilter(type)}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors"
            style={{
              borderColor: filter === type ? EVENT_TYPE_COLORS[type] ?? "#16a34a" : "var(--border-color)",
              background:  filter === type ? `${EVENT_TYPE_COLORS[type] ?? "#16a34a"}18` : "transparent",
              color:       filter === type ? (EVENT_TYPE_COLORS[type] ?? "#16a34a") : "var(--text-muted)",
            }}
          >
            {type ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: EVENT_TYPE_COLORS[type] }} />
                {EVENT_TYPE_LABELS[type]}
              </>
            ) : "Todos"}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        </div>
      )}

      {error && !loading && (
        <div className="py-4 text-center">
          <p className="text-xs" style={{ color: "#ef4444" }}>Erro ao carregar logs: {error}</p>
        </div>
      )}

      {!loading && !error && logs.length === 0 && (
        <div className="py-10 text-center rounded-2xl border" style={{ borderColor: "var(--border-color)" }}>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {filter ? `Nenhum log do tipo "${EVENT_TYPE_LABELS[filter] ?? filter}"` : "Nenhum log registrado ainda."}
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
            As ações do sistema serão registradas aqui automaticamente.
          </p>
        </div>
      )}

      {!loading && !error && logs.length > 0 && (
        <>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border-color)" }}>
            <div
              className="grid grid-cols-[auto_1fr_auto] gap-4 px-4 py-2.5 border-b text-[11px] font-medium"
              style={{ borderColor: "var(--border-color)", color: "var(--text-muted)", background: "var(--bg-input)" }}
            >
              <span>Data/hora</span>
              <span>Ação</span>
              <span>{isAdmin ? "Usuário" : ""}</span>
            </div>
            {logs.map((log) => {
              const ts = new Date(log.created_at).toLocaleString("pt-BR", {
                day: "2-digit", month: "2-digit",
                hour: "2-digit", minute: "2-digit",
              })
              const userLabel = log.user_name ?? log.user_email?.split("@")[0] ?? "—"
              const dotColor  = EVENT_TYPE_COLORS[log.event_type] ?? "#94a3b8"

              return (
                <div
                  key={log.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-3 border-b last:border-b-0"
                  style={{ borderColor: "var(--border-color)", background: "var(--bg-card)" }}
                >
                  <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--text-muted)" }}>
                    {ts}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                      <span className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                        {log.action}
                      </span>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                        style={{ background: `${dotColor}18`, color: dotColor }}
                      >
                        {EVENT_TYPE_LABELS[log.event_type] ?? log.event_type}
                      </span>
                    </div>
                    {log.detail && (
                      <p className="text-[11px] truncate mt-0.5 pl-3.5" style={{ color: "var(--text-muted)" }}>
                        {log.detail}
                      </p>
                    )}
                  </div>
                  <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                    {isAdmin ? userLabel : ""}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-right" style={{ color: "var(--text-muted)" }}>
            Exibindo {logs.length} entrada{logs.length !== 1 ? "s" : ""} mais recente{logs.length !== 1 ? "s" : ""}
          </p>
        </>
      )}
    </div>
  )
}
