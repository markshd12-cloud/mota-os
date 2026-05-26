import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

// ─── Security headers ─────────────────────────────────────────────────────────
// Aplicados via proxy.ts porque o `headers()` do next.config.ts não roda em
// Turbopack dev. Aqui pegamos TODAS as respostas que passam pelo matcher.
const securityHeaders: Record<string, string> = {
  "X-Frame-Options":        "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy":        "strict-origin-when-cross-origin",
  "Permissions-Policy":     "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()",
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value)
  }
  // HSTS apenas em produção (HTTP em localhost quebraria com max-age longo).
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
  }
  return response
}

export async function proxy(request: NextRequest) {
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
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login")

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return applySecurityHeaders(NextResponse.redirect(url))
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    return applySecurityHeaders(NextResponse.redirect(url))
  }

  return applySecurityHeaders(supabaseResponse)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
