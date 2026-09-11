import type { ReactNode } from 'react'

/**
 * The line under a board's title: a state chip, then the sentences that date it — "En vivo ·
 * abierta hasta el 11 de septiembre a las 21:06 · 0 de 20 respuestas", "No iniciado ·
 * Prioridad alta · Vence el 15 de octubre, en 35 días". Handed to `PageTopBar`'s `meta`
 * slot, so it sits inside the header's text column exactly where the boards draw it.
 */
export function PageMeta({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5 text-base text-fg-secondary">{children}</div>
}
