/**
 * Detecção de pedido de geração de imagem no texto do chat.
 * SERVER-SIDE ONLY (mas é função pura — sem dependências).
 *
 * Cobre dois casos:
 *   1. Comando explícito:  /imagem <prompt>  (também /image, /img)
 *   2. Linguagem natural:  "crie/gere/desenhe uma imagem/foto/ilustração de ..."
 *
 * Alta precisão: o caso de linguagem natural exige um VERBO de criação seguido
 * de um SUBSTANTIVO visual, evitando falsos positivos como
 * "como editar uma imagem no Photoshop".
 */

const CMD_RE = /^\/(imagem|image|img)\b\s*([\s\S]*)$/i

// Verbo de criação ... substantivo visual (na mesma frase de abertura).
const NL_RE =
  /^\s*(crie|criar|cria|gere|gerar|gera|desenhe|desenhar|desenha|fa[çc]a|fazer|produza|produzir|ilustre|ilustrar|gere-me|me\s+gere|me\s+crie|me\s+desenhe)\b[^.\n]{0,40}\b(imagem|imagens|foto|fotos|ilustra[çc][ãa]o|desenho|figura|figuras|arte|logo|logotipo|wallpaper|papel\s+de\s+parede|banner|ícone|icone|avatar|pintura|render)\b/i

/**
 * Retorna o prompt a ser usado para gerar a imagem, ou null se não for um
 * pedido de imagem.
 *
 * - Comando `/imagem <prompt>` → retorna `<prompt>` (null se vazio).
 * - Linguagem natural → retorna o texto original (o modelo interpreta a frase).
 */
export function detectImagePrompt(text: string): string | null {
  const t = (text ?? "").trim()
  if (!t) return null

  const cmd = t.match(CMD_RE)
  if (cmd) {
    const q = cmd[2].trim()
    return q.length > 0 ? q : null
  }

  if (NL_RE.test(t)) return t

  return null
}
