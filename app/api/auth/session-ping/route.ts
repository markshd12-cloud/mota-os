import { NextRequest, NextResponse } from "next/server"
import { createClient }      from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { logActivity }       from "@/lib/activity-logger"

export const dynamic = "force-dynamic"

// Nunca bloqueia o usuário — sempre retorna 200 mesmo em erro
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false })

    const body        = await req.json() as { device_fingerprint?: string }
    const fingerprint = body.device_fingerprint?.slice(0, 64) ?? null
    if (!fingerprint) return NextResponse.json({ ok: false })

    const userAgent  = req.headers.get("user-agent") ?? ""
    const forwarded  = req.headers.get("x-forwarded-for")
    const ipAddress  = forwarded
      ? forwarded.split(",")[0].trim()
      : (req.headers.get("x-real-ip") ?? null)
    const deviceName = parseDeviceName(userAgent)

    const admin = createAdminClient()

    // Filtrar por JSONB em código (mais compatível que .filter com arrow notation)
    const { data: allActive } = await admin
      .from("user_sessions")
      .select("id, metadata")
      .eq("user_id", user.id)
      .is("revoked_at", null)

    const match = (allActive ?? []).find(
      (r) => (r.metadata as Record<string, string>)?.device_fingerprint === fingerprint
    )

    const now = new Date().toISOString()

    if (match) {
      await admin
        .from("user_sessions")
        .update({ last_seen_at: now, ip_address: ipAddress })
        .eq("id", match.id)
    } else {
      await admin.from("user_sessions").insert({
        user_id:     user.id,
        ip_address:  ipAddress,
        user_agent:  userAgent,
        device_name: deviceName,
        last_seen_at: now,
        metadata:    { device_fingerprint: fingerprint },
      })

      void logActivity({
        userId:    user.id,
        eventType: "auth",
        action:    "security_session_seen",
        detail:    deviceName,
        metadata:  { ip: ipAddress, device: deviceName },
      })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}

function parseDeviceName(ua: string): string {
  if (!ua) return "Dispositivo desconhecido"
  const lower = ua.toLowerCase()

  let browser = "Navegador"
  if (lower.includes("edg/"))                                      browser = "Edge"
  else if (lower.includes("opr/") || lower.includes("opera"))     browser = "Opera"
  else if (lower.includes("chrome/"))                              browser = "Chrome"
  else if (lower.includes("firefox/"))                             browser = "Firefox"
  else if (lower.includes("safari/") && !lower.includes("chrome")) browser = "Safari"

  let os = "Dispositivo desconhecido"
  if (lower.includes("iphone"))          os = "iPhone"
  else if (lower.includes("ipad"))       os = "iPad"
  else if (lower.includes("android"))    os = "Android"
  else if (lower.includes("windows nt")) os = "Windows"
  else if (lower.includes("macintosh"))  os = "macOS"
  else if (lower.includes("linux"))      os = "Linux"

  return `${browser} · ${os}`
}
