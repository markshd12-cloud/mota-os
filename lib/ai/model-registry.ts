/**
 * Registry de modos de IA disponíveis no chat.
 * Define mapeamento modo → provider/modelo e verifica disponibilidade.
 * SERVER-SIDE ONLY para verificações que usam env vars.
 */

export type AIMode = "jarvis" | "claude" | "gemini" | "chatgpt" | "deepseek";

export interface AIModeConfig {
  id: AIMode;
  label: string;
  icon: string;
  description: string;
}

export const AI_MODE_LIST: AIModeConfig[] = [
  {
    id: "jarvis",
    label: "Jarvis",
    icon: "⚡",
    description: "Jarvis escolhe automaticamente",
  },
  {
    id: "claude",
    label: "Claude",
    icon: "🟠",
    description: "Anthropic Claude Sonnet",
  },
  { id: "gemini", label: "Gemini", icon: "🔵", description: "Google Gemini" },
  { id: "chatgpt", label: "ChatGPT", icon: "🟢", description: "OpenAI GPT-4o" },
  {
    id: "deepseek",
    label: "Deepseek",
    icon: "🔷",
    description: "Deepseek Chat",
  },
];

/** Mapeamento de modo → provider + modelo padrão (server-side) */
const MODE_TO_PROVIDER: Record<
  Exclude<AIMode, "jarvis">,
  { provider: string; model: string }
> = {
  claude: { provider: "anthropic", model: "claude-sonnet-4-6" },
  gemini: { provider: "gemini", model: "gemini-2.5-flash" },
  chatgpt: { provider: "openai", model: "gpt-4o" },
  deepseek: { provider: "deepseek", model: "deepseek-chat" },
};

/** Verifica se o provider do modo está configurado. */
export function isProviderConfigured(provider: string): boolean {
  switch (provider) {
    case "anthropic":
      // API key estática OU Auth0 WIF (sem arquivo — token buscado dinamicamente)
      return !!(
        process.env.ANTHROPIC_API_KEY ||
        (process.env.AUTH0_DOMAIN &&
          process.env.AUTH0_CLIENT_ID &&
          process.env.AUTH0_CLIENT_SECRET)
      );
    case "openai":
      // API key estática OU OAuth/Codex (client OAuth configurado)
      return !!(
        process.env.OPENAI_API_KEY || process.env.OPENAI_OAUTH_CLIENT_ID
      );
    case "gemini":
      // Nomes reais usados no projeto: GEMINI_API_KEY (gemini.ts) e
      // GOOGLE_SERVICE_ACCOUNT_KEY (gemini-service-account.ts).
      // GOOGLE_CLIENT_ID cobre o fluxo de OAuth do usuário.
      return !!(
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
        process.env.GOOGLE_CLIENT_ID
      );
    case "deepseek":
      return !!process.env.DEEPSEEK_API_KEY;
    default:
      return false;
  }
}

/**
 * Retorna provider/model para um modo de IA.
 * Retorna null se o provider não estiver configurado.
 */
export function resolveAIMode(
  mode: AIMode,
):
  | { provider: string; model: string; routedByJarvis: boolean }
  | { error: string } {
  if (mode === "jarvis") {
    // Modo automático. O provedor primário é configurável via
    // JARVIS_DEFAULT_PROVIDER (claude|gemini|chatgpt|deepseek) — útil para
    // priorizar uma IA com saldo. Se não definido/indisponível, cai no Claude.
    // Em qualquer caso, o fallback automático (streamChatWithFallback) cobre
    // a falha do primário trocando para outro provedor em runtime.
    const pref = (process.env.JARVIS_DEFAULT_PROVIDER ?? "claude").toLowerCase();
    const chosen =
      isAIMode(pref) && pref !== "jarvis" ? MODE_TO_PROVIDER[pref] : null;

    if (chosen && isProviderConfigured(chosen.provider)) {
      return { provider: chosen.provider, model: chosen.model, routedByJarvis: true };
    }
    return {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      routedByJarvis: true,
    };
  }

  const cfg = MODE_TO_PROVIDER[mode];
  if (!isProviderConfigured(cfg.provider)) {
    const labels: Record<string, string> = {
      anthropic: "Anthropic",
      openai: "OpenAI",
      gemini: "Google Gemini",
      deepseek: "Deepseek",
    };
    return {
      error: `${labels[cfg.provider] ?? cfg.provider} não está configurado. Acesse Configurações → APIs para adicionar a chave.`,
    };
  }

  return { provider: cfg.provider, model: cfg.model, routedByJarvis: false };
}

export function isAIMode(v: string): v is AIMode {
  return ["jarvis", "claude", "gemini", "chatgpt", "deepseek"].includes(v);
}

/** Label legível para exibir na UI ("Claude Sonnet 4.6", "GPT-4o", etc.) */
export function modelLabel(provider: string, model: string): string {
  if (provider === "anthropic") {
    if (model.includes("sonnet")) return "Claude Sonnet";
    if (model.includes("haiku")) return "Claude Haiku";
    if (model.includes("opus")) return "Claude Opus";
    return `Claude (${model})`;
  }
  if (provider === "openai") {
    if (model === "gpt-4o") return "GPT-4o";
    if (model.includes("mini")) return "GPT-4o Mini";
    return `OpenAI (${model})`;
  }
  if (provider === "gemini") {
    if (model.includes("flash")) return "Gemini Flash";
    if (model.includes("pro")) return "Gemini Pro";
    return `Gemini (${model})`;
  }
  if (provider === "deepseek") return "Deepseek Chat";
  return model;
}
