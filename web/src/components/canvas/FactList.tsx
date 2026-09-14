import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/** One row of a fact sheet: the term, already translated, and whatever renders its value. */
export interface Fact {
  id: string
  term: string
  value: ReactNode
}

/**
 * The boards' "Ficha": a two-column `dl`, the term in the tertiary ink and the value in
 * whatever the value is (a chip, a mono date, a link).
 *
 * The term column is the one thing the boards vary — 112px on Detalle de plan, 96px on
 * Detalle de microclima, 88px on Resultados and on Crear's Resumen — so it is a named width
 * rather than a free number. The Resumen also sets the terms at 12px (`size="sm"`).
 */
export function FactList({
  facts,
  termWidth = 'md',
  size = 'base',
}: {
  facts: readonly Fact[]
  termWidth?: 'sm' | 'md' | 'lg'
  size?: 'sm' | 'base'
}) {
  return (
    <dl
      className={cn(
        'm-0 grid items-center gap-x-3 gap-y-2.5',
        termWidth === 'sm' && 'grid-cols-[88px_minmax(0,1fr)]',
        termWidth === 'md' && 'grid-cols-[96px_minmax(0,1fr)]',
        termWidth === 'lg' && 'grid-cols-[112px_minmax(0,1fr)]',
        size === 'sm' ? 'text-sm' : 'text-base',
      )}
    >
      {facts.map((fact) => (
        <div key={fact.id} className="contents">
          <dt className="text-fg-tertiary">{fact.term}</dt>
          <dd className="m-0 min-w-0 text-base text-fg-primary">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
