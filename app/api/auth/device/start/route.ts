import { NextResponse } from "next/server"
import { getOauthConfig, getTokenRequestHeaders } from "@/lib/codex-oauth"

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
}

export async function POST() {
  const oauth = getOauthConfig()
  if (!oauth.clientId) {
    return NextResponse.json({ error: "OPENAI_OAUTH_CLIENT_ID não configurado" }, { status: 500 })
  }

  const body = new URLSearchParams({
    client_id: oauth.clientId,
    scope: oauth.scope,
  })

  const res = await fetch(oauth.deviceCodeUrl, {
    method: "POST",
    headers: getTokenRequestHeaders(),
    body,
    cache: "no-store",
  })

  if (!res.ok) {
    const errorText = await res.text()
    const blockedByChallenge = /just a moment|enable javascript and cookies/i.test(errorText)

    return NextResponse.json(
      {
        error: blockedByChallenge
          ? "O endpoint de device flow da OpenAI bloqueou a chamada do servidor (Cloudflare challenge)."
          : "Falha ao iniciar device flow",
        status: res.status,
        details: blockedByChallenge
          ? "Esse fluxo exige validação de browser/cookies no endpoint remoto e não pode ser iniciado por fetch server-to-server neste ambiente."
          : errorText,
      },
      { status: res.status },
    )
  }

  const data = await res.json() as DeviceCodeResponse
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    return NextResponse.json(
      { error: "Resposta inválida do provedor OAuth para device flow" },
      { status: 502 },
    )
  }

  return NextResponse.json({
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    verification_uri_complete: data.verification_uri_complete,
    expires_in: data.expires_in ?? 900,
    interval: data.interval ?? 5,
  })
}
