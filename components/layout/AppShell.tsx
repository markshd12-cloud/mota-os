"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { CompanyProvider } from "@/components/providers/CompanyProvider";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { useIsMobile } from "@/hooks/useIsMobile";

function useSessionPing() {
  useEffect(() => {
    let fp = localStorage.getItem("mota_device_fp");
    if (!fp) {
      fp = crypto.randomUUID();
      localStorage.setItem("mota_device_fp", fp);
    }
    fetch("/api/auth/session-ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_fingerprint: fp }),
    }).catch(() => {});
  }, []);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();
  const pathname = usePathname();
  useSessionPing();

  // Fecha o drawer ao navegar entre páginas no mobile
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <CompanyProvider>
      <div
        className="flex h-dvh overflow-hidden"
        style={{ background: "var(--bg-app)" }}
      >
        {/* ─── Sidebar ─────────────────────────────────────────────── */}
        {isMobile ? (
          <>
            {/* Overlay */}
            <AnimatePresence>
              {mobileOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setMobileOpen(false)}
                  className="fixed inset-0 z-40 bg-black/50"
                />
              )}
            </AnimatePresence>

            {/* Drawer */}
            <AnimatePresence>
              {mobileOpen && (
                <motion.div
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="fixed inset-y-0 left-0 z-50"
                >
                  <ErrorBoundary label="Navegação">
                    <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} />
                  </ErrorBoundary>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <ErrorBoundary label="Navegação">
            <Sidebar
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed(v => !v)}
            />
          </ErrorBoundary>
        )}

        {/* ─── Conteúdo ────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          {/* Barra superior mobile com hamburguer */}
          {isMobile && (
            <div
              className="flex items-center gap-3 h-12 px-3 border-b shrink-0"
              style={{
                borderColor: "var(--border-color)",
                background:  "var(--bg-sidebar)",
              }}
            >
              <button
                onClick={() => setMobileOpen(true)}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
                style={{ color: "var(--text-secondary)" }}
                aria-label="Abrir menu"
              >
                <Menu size={18} />
              </button>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-mota-600 flex items-center justify-center">
                  <span className="text-white font-bold text-[10px]">M</span>
                </div>
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Jarvis
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            <ErrorBoundary label="Conteúdo">
              {children}
            </ErrorBoundary>
          </div>
        </div>
      </div>

      <Toaster
        position="bottom-right"
        theme="dark"
        richColors
        closeButton
        toastOptions={{
          style: {
            background: "var(--bg-card)",
            border:     "1px solid var(--border-color)",
            color:      "var(--text-primary)",
          },
        }}
      />
    </CompanyProvider>
  );
}
