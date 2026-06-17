import type { NextConfig } from "next";
import path from "path";

// ─── Security Headers ─────────────────────────────────────────────────────────
// Aplicados a todas as rotas.
// CSP em dev precisa liberar websocket/HMR e devtunnels/Cloudflare quando usados.
const isDev = process.env.NODE_ENV !== "production";

const devOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://192.168.68.140:3000",
  "https://x8b8ttvn-3000.brs.devtunnels.ms",
  "https://*.devtunnels.ms",
  "https://*.brs.devtunnels.ms",
  "https://*.trycloudflare.com",
];

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // HSTS — força HTTPS. Apenas em produção: em dev (http://localhost) o browser
  // fixaria o host em https e quebraria o acesso local.
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]),
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https:",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' https:${isDev ? " http:" : ""}`,
      `connect-src 'self' https: wss:${isDev ? " http: ws:" : ""}`,
      "form-action 'self' https://auth.contaazul.com",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },

  allowedDevOrigins: [
    "localhost:3000",
    "127.0.0.1:3000",
    "192.168.68.140:3000",
    "x8b8ttvn-3000.brs.devtunnels.ms",
    "*.devtunnels.ms",
    "*.brs.devtunnels.ms",
    "*.trycloudflare.com",
  ],

  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "127.0.0.1:3000",
        "192.168.68.140:3000",
        "x8b8ttvn-3000.brs.devtunnels.ms",
        "*.devtunnels.ms",
        "*.brs.devtunnels.ms",
        "*.trycloudflare.com",
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
