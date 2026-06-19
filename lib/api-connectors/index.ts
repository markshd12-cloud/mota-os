/**
 * API connectors — barrel export
 *
 * Import individual connectors from this file:
 *   import { createClaudeClient } from "@/lib/api-connectors"
 *
 * All connectors are server-side only. Never import them in client components
 * ("use client") — use Next.js Route Handlers or Server Actions instead.
 */

export * from "./claude"
export * from "./openai"
export * from "./gemini"
export * from "./rocketchat"
export * from "./whatsapp"
export * from "./google-drive"
