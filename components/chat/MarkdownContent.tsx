"use client"

import { useState, memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy } from "lucide-react"

// Renderiza markdown da resposta da IA com estilos do tema:
// títulos, negrito/itálico, listas, tabelas, código (inline e bloco), citações, links.

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }).catch(() => {})
  }
  return (
    <div className="my-2 rounded-xl overflow-hidden border" style={{ borderColor: "var(--border-color)" }}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b"
        style={{ borderColor: "var(--border-color)", background: "var(--bg-input)" }}>
        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{lang || "código"}</span>
        <button onClick={copy} className="flex items-center gap-1 text-[10px] transition-colors hover:opacity-80"
          style={{ color: copied ? "#16a34a" : "var(--text-muted)" }}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-relaxed"
        style={{ background: "var(--bg-sidebar)" }}>
        <code className="font-mono" style={{ color: "var(--text-primary)" }}>{code}</code>
      </pre>
    </div>
  )
}

function MarkdownContentInner({ content }: { content: string }) {
  return (
    <div className="md-content text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1.5 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[15px] font-bold mt-3 mb-1.5 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-2.5 mb-1 first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h4>,
          p:  ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-1.5 ml-1 space-y-1 list-disc list-inside">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 ml-1 space-y-1 list-decimal list-inside">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a:  ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer"
              className="underline underline-offset-2" style={{ color: "var(--mota-600, #16a34a)" }}>
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 pl-3 border-l-2 italic"
              style={{ borderColor: "var(--mota-600, #16a34a)", color: "var(--text-secondary)" }}>
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3" style={{ borderColor: "var(--border-color)" }} />,
          // Imagens (ex: imagens geradas pela IA) — limita largura e arredonda
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={typeof src === "string" ? src : ""}
              alt={alt ?? ""}
              loading="lazy"
              className="my-2 max-w-full h-auto rounded-xl border"
              style={{ borderColor: "var(--border-color)", maxHeight: "32rem" }}
            />
          ),
          // Tabelas (GFM)
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border-color)" }}>
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead style={{ background: "var(--bg-input)" }}>{children}</thead>,
          th: ({ children }) => (
            <th className="text-left font-semibold px-3 py-2 border-b"
              style={{ borderColor: "var(--border-color)", color: "var(--text-primary)" }}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 border-b align-top"
              style={{ borderColor: "var(--border-color)", color: "var(--text-secondary)" }}>
              {children}
            </td>
          ),
          // Código
          code: (props) => {
            const { className, children } = props as { className?: string; children?: React.ReactNode }
            const match = /language-(\w+)/.exec(className ?? "")
            const text = String(children ?? "").replace(/\n$/, "")
            // Bloco de código (tem language- ou múltiplas linhas)
            if (match || text.includes("\n")) {
              return <CodeBlock code={text} lang={match?.[1]} />
            }
            // Código inline
            return (
              <code className="px-1.5 py-0.5 rounded font-mono text-[12px]"
                style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}>
                {children}
              </code>
            )
          },
          pre: ({ children }) => <>{children}</>, // o <code> já cuida do bloco
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownContent = memo(MarkdownContentInner)
