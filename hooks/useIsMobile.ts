"use client"

import { useState, useEffect } from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Retorna true quando a viewport é <= 768px (tablet/celular).
 * SSR-safe: assume desktop (false) até a montagem no client.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)
    const update = () => setIsMobile(mql.matches)

    update()
    mql.addEventListener("change", update)
    return () => mql.removeEventListener("change", update)
  }, [])

  return isMobile
}
