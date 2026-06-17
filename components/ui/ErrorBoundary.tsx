"use client"

import { Component, type ReactNode } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

interface Props {
  children:  ReactNode
  fallback?: ReactNode
  label?:    string   // contexto para o título do erro (ex: "Chat", "Dashboard")
}

interface State {
  hasError:     boolean
  errorMessage: string
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, errorMessage: "" }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message }
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", error)
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: "" })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    if (this.props.fallback)  return this.props.fallback

    const section = this.props.label ? `(${this.props.label})` : ""

    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center"
        style={{ color: "var(--text-secondary)" }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "rgba(239,68,68,0.1)" }}
        >
          <AlertTriangle size={22} style={{ color: "#f87171" }} />
        </div>

        <div className="flex flex-col gap-1 max-w-xs">
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            Algo deu errado {section}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Ocorreu um erro inesperado. Tente recarregar esta seção.
          </p>
        </div>

        <button
          onClick={this.handleReset}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{
            background:   "var(--bg-hover)",
            color:        "var(--text-primary)",
            border:       "1px solid var(--border-color)",
          }}
        >
          <RefreshCw size={14} />
          Tentar novamente
        </button>
      </div>
    )
  }
}
