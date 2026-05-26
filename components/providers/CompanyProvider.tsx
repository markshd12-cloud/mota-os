"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

export interface CompanyInfo {
  slug:        string
  name:        string
  color:       string
  initials:    string
  description: string | null
  active:      boolean
}

interface CompanyContextValue {
  currentCompany:    CompanyInfo | null
  allowedCompanies:  CompanyInfo[]
  loading:           boolean
  userRole:          string | null
  isAdmin:           boolean
  setCurrentCompany: (slug: string) => Promise<boolean>
  refresh:           () => void
}

const CompanyContext = createContext<CompanyContextValue>({
  currentCompany:    null,
  allowedCompanies:  [],
  loading:           true,
  userRole:          null,
  isAdmin:           false,
  setCurrentCompany: async () => false,
  refresh:           () => {},
})

export function useCompany() {
  return useContext(CompanyContext)
}

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [currentCompany,   setCurrentCompanyState] = useState<CompanyInfo | null>(null)
  const [allowedCompanies, setAllowedCompanies]    = useState<CompanyInfo[]>([])
  const [userRole,         setUserRole]            = useState<string | null>(null)
  const [loading,          setLoading]             = useState(true)

  const fetchData = useCallback(() => {
    setLoading(true)
    fetch("/api/current-company")
      .then(r => r.json() as Promise<{ company: CompanyInfo | null; allowed: CompanyInfo[]; role: string }>)
      .then(({ company, allowed, role }) => {
        setCurrentCompanyState(company)
        setAllowedCompanies(allowed ?? [])
        setUserRole(role ?? "viewer")
      })
      .catch(() => { /* falha silenciosa — usuário não logado ou rede off */ })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const setCurrentCompany = useCallback(async (slug: string): Promise<boolean> => {
    const prev  = currentCompany
    const found = allowedCompanies.find(c => c.slug === slug)
    if (found) setCurrentCompanyState(found)

    const res = await fetch("/api/current-company", {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ company_id: slug }),
    })
    if (!res.ok) {
      setCurrentCompanyState(prev)
      return false
    }
    return true
  }, [allowedCompanies, currentCompany])

  return (
    <CompanyContext.Provider value={{
      currentCompany,
      allowedCompanies,
      loading,
      userRole,
      isAdmin: userRole === "admin",
      setCurrentCompany,
      refresh: fetchData,
    }}>
      {children}
    </CompanyContext.Provider>
  )
}
