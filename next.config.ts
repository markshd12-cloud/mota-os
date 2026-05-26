import type { NextConfig } from "next";
import path from "path";

// ─── Security Headers ─────────────────────────────────────────────────────────
// Aplicados a TODAS as rotas. Tradeoffs:
//
// - X-Frame-Options DENY:           impede que qualquer site embede a app em iframe (clickjacking).
//                                   Se algum dia precisar embedar telas em outro domínio, trocar
//                                   por ALLOW-FROM ou usar CSP frame-ancestors.
//
// - X-Content-Type-Options nosniff: impede o browser de "adivinhar" o Content-Type — defesa contra
//                                   XSS via uploads de arquivos com extensão enganosa.
//
// - Referrer-Policy:                URLs internas não vazam para terceiros. Mantém origin para
//                                   navegação interna (útil pra analytics próprio).
//
// - Permissions-Policy:             desliga APIs do browser que o app não usa. Lista positivamente
//                                   permitida deve estar vazia para a maioria dos sensores.
//
// - Strict-Transport-Security:      força HTTPS em produção. NÃO aplicar em dev (HTTP no localhost).
//
// CSP (Content-Security-Policy) NÃO está aplicada aqui ainda. Antes de ativar:
//   1. Mapear todos os domínios que a app chama (Supabase, Anthropic, RocketChat, Gemini, etc.).
//   2. Testar em modo `Content-Security-Policy-Report-Only` por uma semana.
//   3. Cuidado com framer-motion (usa inline-style) e Next.js (usa inline-script para hidratação).
//      → exige `style-src 'self' 'unsafe-inline'` e `script-src 'self' 'unsafe-inline'` ou
//        usar nonces gerados pelo proxy.ts.
const securityHeaders = [
  { key: "X-Frame-Options",        value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
  {
    key:   "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()",
  },
  // HSTS só em produção (HTTPS). 2 anos + subdomínios + preload.
  ...(process.env.NODE_ENV === "production"
    ? [{
        key:   "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      }]
    : []),
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },

  allowedDevOrigins: [
    "x8b8ttvn-3000.brs.devtunnels.ms",
    "*.devtunnels.ms",
    "*.brs.devtunnels.ms",
  ],

  experimental: {
    serverActions: {
      allowedOrigins: [
        "x8b8ttvn-3000.brs.devtunnels.ms",
        "*.devtunnels.ms",
        "*.brs.devtunnels.ms",
      ],
    },
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
