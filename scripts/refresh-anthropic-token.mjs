import { writeFileSync, mkdirSync } from "fs"
import { dirname }                  from "path"

const {
  AUTH0_DOMAIN,
  AUTH0_CLIENT_ID,
  AUTH0_CLIENT_SECRET,
  ANTHROPIC_IDENTITY_TOKEN_FILE,
} = process.env

const missing = ["AUTH0_DOMAIN","AUTH0_CLIENT_ID","AUTH0_CLIENT_SECRET","ANTHROPIC_IDENTITY_TOKEN_FILE"]
  .filter(k => !process.env[k])

if (missing.length) {
  console.error(`[refresh-token] Variáveis ausentes: ${missing.join(", ")}`)
  process.exit(1)
}

const res = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
  method:  "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    grant_type:    "client_credentials",
    client_id:     AUTH0_CLIENT_ID,
    client_secret: AUTH0_CLIENT_SECRET,
    audience:      "https://api.anthropic.com",
  }),
})

if (!res.ok) {
  const body = await res.text()
  console.error(`[refresh-token] Auth0 retornou ${res.status}: ${body}`)
  process.exit(1)
}

const { access_token } = await res.json()

mkdirSync(dirname(ANTHROPIC_IDENTITY_TOKEN_FILE), { recursive: true })
writeFileSync(ANTHROPIC_IDENTITY_TOKEN_FILE, access_token, "utf8")

console.log(`[refresh-token] Token salvo em ${ANTHROPIC_IDENTITY_TOKEN_FILE}`)
