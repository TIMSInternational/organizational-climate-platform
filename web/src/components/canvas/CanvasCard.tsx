import { useId, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * The artboards' card: the hairline, 8px radius and faint shadow every board of 10 Sep
 * draws (`shell.py` `card()`), a serif `h2` at 20px, and an optional count and right-hand
 * meta line on the heading's baseline.
 *
 * ## Why this lives in `components/canvas` and not in a feature
 *
 * The five admin boards of the "admin-gaps-authoring" lane (Detalle de plan, Crear,
 * Detalle, Analítica and Resultados de microclima) all draw this exact card, and the
 * action-plan page and the microclimate pages are two features. A card copied into each
 * would be two cards the next restyle has to find. `components/ui` holds controls; this is
 * page grammar, so it has its own folder.
 *
 * ## The two insets
 *
 * A main-column card is `16px 20px 18px`; a right-column card is `16px 18px 18px`
 * (`padding=` on every `card()` call in `build_admin_gaps_authoring.py`). `inset` names
 * which, so a caller never writes the padding by hand.
 */
export interface CanvasCardProps {
  /** Already translated. Rendered as the card's `h2`. */
  title: string
  /** A count printed beside the title in mono, as "Preguntas 2" draws it. */
  count?: number
  /** Chips beside the title — the "Propuesta" chip on a proposed region. */
  adornment?: ReactNode
  /** The right-hand meta line: "1 entrada", "frente a las esperadas". */
  aside?: ReactNode
  inset?: 'main' | 'side'
  className?: string
  children: ReactNode
}

export function CanvasCard({ title, count, adornment, aside, inset = 'main', className, children }: CanvasCardProps) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border border-line-default bg-surface-card pt-4 pb-4.5 shadow-xs',
        inset === 'side' ? 'px-4.5' : 'px-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          {/* No margin: index.css gives every h2 a bottom margin the card's gap already makes. */}
          <h2 id={headingId} className="m-0 text-2xl">
            {title}
          </h2>
          {count !== undefined && (
            <span className="font-mono text-sm tabular-nums text-fg-tertiary">{count}</span>
          )}
          {adornment}
        </div>
        {aside !== undefined && aside !== null && (
          <span className="text-right text-sm text-fg-tertiary">{aside}</span>
        )}
      </div>
      {children}
    </section>
  )
}

/**
 * A section heading that sits OUTSIDE a card — "Por pregunta 2", "Todas las sesiones 1" —
 * with the same count and right-hand meta the card heading carries.
 */
export function CanvasSectionHead({
  title,
  count,
  aside,
  id,
}: {
  title: string
  count?: number
  aside?: ReactNode
  id?: string
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h2 id={id} className="m-0 text-2xl">
          {title}
        </h2>
        {count !== undefined && <span className="font-mono text-sm tabular-nums text-fg-tertiary">{count}</span>}
      </div>
      {aside !== undefined && aside !== null && <span className="text-right text-sm text-fg-tertiary">{aside}</span>}
    </div>
  )
}
