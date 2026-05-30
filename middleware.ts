import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

// ─── CSRF: verifica Origin em mutations da API ────────────────────────────────
// Webhooks externos (/api/webhooks/*) são excluídos — usam secret próprio.
function isCsrfSafe(request: NextRequest): boolean {
  const method = request.method
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true

  const pathname = request.nextUrl.pathname
  if (pathname.startsWith("/api/webhooks/")) return true  // autenticados por secret

  const origin  = request.headers.get("origin")
  const host    = request.headers.get("host")
  if (!origin || !host) return true  // sem Origin (ex: curl server-side) → permitir

  try {
    const originHost = new URL(origin).host
    return originHost === host
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  // Rejeitar mutations com Origin diferente do host (CSRF)
  if (!isCsrfSafe(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    },
  )

  // Não inserir lógica entre createServerClient e getUser — quebra refresh de token
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth/")

  // Rotas de API têm própria verificação de auth — middleware não interfere
  const isApiRoute = pathname.startsWith("/api/")

  if (!user && !isAuthRoute && !isApiRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}