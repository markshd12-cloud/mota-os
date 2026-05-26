"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import {
  LayoutDashboard,
  MessageSquare,
  Bookmark,
  Tag,
  Archive,
  FolderOpen,
  Database,
  Globe,
  Boxes,
  HardDrive,
  Bot,
  Zap,
  Puzzle,
  GitBranch,
  CalendarClock,
  Eye,
  Sparkles,
  Settings,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Clock,
  LogOut,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase-browser"
import { useCompany } from "@/components/providers/CompanyProvider"

interface NavItem {
  label:      string
  href?:      string
  icon:       React.ElementType
  children?:  NavItem[]
  badge?:     number
  adminOnly?: boolean
}

const ALL_NAV_ITEMS: NavItem[] = [
  {
    label:     "Dashboard",
    href:      "/dashboard",
    icon:      LayoutDashboard,
    adminOnly: true,
  },
  {
    label: "Chat",
    href:  "/chat",
    icon:  MessageSquare,
  },
  {
    label: "Sessões",
    icon:  Clock,
    children: [
      { label: "Todas as sessões", href: "/chat",                icon: MessageSquare },
      { label: "Marcadas",         href: "/chat?filter=marked",  icon: Bookmark      },
      { label: "Tags",             href: "/chat?filter=tags",    icon: Tag           },
      { label: "Arquivadas",       href: "/chat?filter=archived",icon: Archive       },
    ],
  },
  {
    label: "Projetos",
    href:  "/projects",
    icon:  FolderOpen,
  },
  {
    label: "Fontes",
    icon:  Database,
    children: [
      { label: "APIs",          href: "/sources?type=api",    icon: Globe     },
      { label: "MCPs",          href: "/sources?type=mcp",    icon: Boxes     },
      { label: "Pastas locais", href: "/sources?type=folder", icon: HardDrive },
      { label: "Ver tudo",      href: "/sources",             icon: Database  },
    ],
  },
  {
    label: "Agentes",
    href:  "/agents",
    icon:  Bot,
  },
  {
    label: "Automações",
    icon:  Zap,
    children: [
      { label: "Skills",        href: "/automations?tab=skills",    icon: Puzzle      },
      { label: "Workflows",     href: "/workflows",                  icon: GitBranch   },
      { label: "Agendamentos",  href: "/automations?tab=schedules", icon: CalendarClock },
      { label: "Vigias",        href: "/automations?tab=watchers",  icon: Eye         },
    ],
  },
]

interface SidebarProps {
  collapsed: boolean
  onToggle:  () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname  = usePathname()
  const router    = useRouter()
  const { isAdmin, loading: companyLoading } = useCompany()

  const [openGroups, setOpenGroups] = useState<Set<string>>(
    new Set(["Sessões", "Automações"])
  )
  const [userEmail,   setUserEmail]   = useState<string | null>(null)
  const [userInitial, setUserInitial] = useState("U")
  const [unreadNews,  setUnreadNews]  = useState(0)

  useEffect(() => {
    fetch("/api/profile")
      .then(r => r.ok ? r.json() : null)
      .then((data: { email?: string } | null) => {
        if (data?.email) {
          setUserEmail(data.email)
          setUserInitial((data.email[0] ?? "U").toUpperCase())
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    function fetchUnread() {
      fetch("/api/announcements/unread-count")
        .then(r => r.json())
        .then(data => setUnreadNews(typeof data.count === "number" ? data.count : 0))
        .catch(() => {})
    }
    fetchUnread()
    window.addEventListener("announcements-read", fetchUnread)
    return () => window.removeEventListener("announcements-read", fetchUnread)
  }, [])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  function toggleGroup(label: string) {
    setOpenGroups(prev => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  function isActive(href?: string) {
    if (!href) return false
    const base = href.split("?")[0]
    return pathname === base || (base !== "/" && pathname.startsWith(base))
  }

  // Filtrar itens baseado no role (enquanto carrega, ocultar adminOnly)
  const navItems = companyLoading
    ? ALL_NAV_ITEMS.filter(i => !i.adminOnly)
    : ALL_NAV_ITEMS.filter(i => !i.adminOnly || isAdmin)

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : 240 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className="flex flex-col h-full shrink-0 overflow-hidden border-r"
      style={{ background: "var(--bg-sidebar)", borderColor: "var(--border-color)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-14 shrink-0 border-b" style={{ borderColor: "var(--border-color)" }}>
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-2 min-w-0"
            >
              <div className="w-7 h-7 rounded-lg bg-mota-600 flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-xs">M</span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-none truncate" style={{ color: "var(--text-primary)" }}>
                  Jarvis
                </p>
                <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
                  Grupo Mota Educação
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {collapsed && (
          <div className="w-7 h-7 rounded-lg bg-mota-600 flex items-center justify-center mx-auto">
            <span className="text-white font-bold text-xs">M</span>
          </div>
        )}

        {!collapsed && (
          <button
            onClick={onToggle}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-hover)] shrink-0"
            style={{ color: "var(--text-muted)" }}
          >
            <PanelLeftClose size={15} />
          </button>
        )}
      </div>

      {/* Nova Sessão */}
      <div className="px-2.5 py-3 shrink-0">
        <Link href="/chat">
          <motion.div
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer transition-colors",
              "bg-mota-600 hover:bg-mota-700 text-white",
              collapsed && "justify-center px-0"
            )}
          >
            <Plus size={15} className="shrink-0" />
            <AnimatePresence mode="wait">
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-sm font-medium truncate"
                >
                  Nova Sessão
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {navItems.map(item => (
          <NavEntry
            key={item.label}
            item={item}
            collapsed={collapsed}
            isActive={isActive}
            openGroups={openGroups}
            toggleGroup={toggleGroup}
          />
        ))}

        <div className="my-2 border-t" style={{ borderColor: "var(--border-color)" }} />

        {([
          { label: "Novidades",      href: "/changelog", icon: Sparkles, badge: unreadNews > 0 ? unreadNews : undefined },
          { label: "Configurações",  href: "/settings",  icon: Settings },
        ] as NavItem[]).map(item => (
          <NavEntry
            key={item.label}
            item={item}
            collapsed={collapsed}
            isActive={isActive}
            openGroups={openGroups}
            toggleGroup={toggleGroup}
          />
        ))}
      </nav>

      {/* User */}
      <div className="px-2.5 py-3 border-t shrink-0" style={{ borderColor: "var(--border-color)" }}>
        <div className={cn("flex items-center gap-2.5 rounded-lg px-2 py-2", collapsed && "justify-center")}>
          <div className="w-7 h-7 rounded-full bg-mota-600 flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-semibold">{userInitial}</span>
          </div>
          <AnimatePresence mode="wait">
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-1 items-center justify-between min-w-0"
              >
                <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                  {userEmail ?? "…"}
                </p>
                <button
                  onClick={handleLogout}
                  title="Sair"
                  className="ml-1 p-1 rounded transition-colors hover:bg-[var(--bg-hover)] shrink-0"
                  style={{ color: "var(--text-muted)" }}
                >
                  <LogOut size={13} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Collapse button when collapsed */}
      {collapsed && (
        <div className="px-2.5 pb-3 shrink-0">
          <button
            onClick={onToggle}
            className="w-full flex items-center justify-center h-8 rounded-md transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: "var(--text-muted)" }}
          >
            <PanelLeftOpen size={15} />
          </button>
        </div>
      )}
    </motion.aside>
  )
}

interface NavEntryProps {
  item:        NavItem
  collapsed:   boolean
  isActive:    (href?: string) => boolean
  openGroups:  Set<string>
  toggleGroup: (label: string) => void
  depth?:      number
}

function NavEntry({ item, collapsed, isActive, openGroups, toggleGroup, depth = 0 }: NavEntryProps) {
  const hasChildren = !!item.children?.length
  const isOpen  = openGroups.has(item.label)
  const active  = isActive(item.href)

  if (hasChildren && !collapsed) {
    return (
      <div>
        <button
          onClick={() => toggleGroup(item.label)}
          className={cn(
            "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors text-left",
            "hover:bg-[var(--bg-hover)]",
            depth > 0 && "pl-7"
          )}
          style={{ color: "var(--text-secondary)" }}
        >
          <item.icon size={15} className="shrink-0" />
          <span className="flex-1 text-sm truncate">{item.label}</span>
          <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronDown size={13} />
          </motion.div>
        </button>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="pl-3 space-y-0.5 pt-0.5">
                {item.children!.map(child => (
                  <NavEntry
                    key={child.label}
                    item={child}
                    collapsed={collapsed}
                    isActive={isActive}
                    openGroups={openGroups}
                    toggleGroup={toggleGroup}
                    depth={depth + 1}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  if (hasChildren && collapsed) {
    return (
      <div
        className="flex items-center justify-center h-9 rounded-lg transition-colors cursor-pointer hover:bg-[var(--bg-hover)]"
        style={{ color: "var(--text-secondary)" }}
        title={item.label}
      >
        <item.icon size={15} />
      </div>
    )
  }

  return (
    <Link href={item.href ?? "#"}>
      <motion.div
        whileHover={{ x: collapsed ? 0 : 2 }}
        transition={{ duration: 0.1 }}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors cursor-pointer",
          collapsed ? "justify-center" : "",
          active
            ? "bg-[var(--bg-active)] text-mota-600 dark:text-mota-500"
            : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
          depth > 0 && !collapsed && "pl-3"
        )}
        title={collapsed ? item.label : undefined}
      >
        <item.icon size={15} className="shrink-0" />
        <AnimatePresence mode="wait">
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 items-center justify-between min-w-0"
            >
              <span className="text-sm truncate">{item.label}</span>
              {item.badge !== undefined && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-mota-600 text-white shrink-0">
                  {item.badge}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {collapsed && item.badge !== undefined && (
          <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-mota-500" />
        )}
      </motion.div>
    </Link>
  )
}
