import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * The line under a board's title: a state chip, then the sentences that date it — "En vivo ·
 * abierta hasta el 11 de septiembre a las 21:06 · 0 de 20 respuestas", "No iniciado ·
 * Prioridad alta · Vence el 15 de octubre, en 35 días". Handed to `PageTopBar`'s `meta`
 * slot, so it sits inside the header's text column exactly where the boards draw it.
 */
export function PageMeta({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5 text-base text-fg-secondary">{children}</div>
}

export interface PageMetaSentence {
  id: string
  text: string
  /** Set in the tertiary ink, as the boards set the tally ("· 0 de 20 respuestas"). */
  muted?: boolean
}

/**
 * The sentences after the chip, each after the first led by the boards' "·": "abierta hasta el
 * 11 de septiembre a las 21:06 · 0 de 20 respuestas" (MicroclimateDetail.dc.html, where the
 * tally is its own span, "· 0 de 20 respuestas", 10px after the date).
 *
 * The run wraps without ever opening a line with that "·". A sentence that moves to a new line
 * — at 1024 the header's text column is narrower than the tally needs — leaves its separator
 * behind, clipped: each later sentence is pulled back 8px by its own negative margin, and those
 * 8px are exactly the box its "·" sits in. Mid-line, the run's 18px column gap less the 8px
 * leaves the board's 10px before the "·"; at the start of a line the 8px fall outside the run,
 * whose `overflow-hidden` clips them. The first cut put "· " in the copy, and the wrapped tally
 * opened its line with it.
 *
 * The run keeps beside the chip (a zero basis, then it grows) and wraps under its own first
 * word, and every line is 22px, the chip's height, so a chip set `self-start` sits on the first
 * line and a one-line run centres exactly as `PageMeta`'s other items do.
 */
export function PageMetaSentences({ sentences }: { sentences: PageMetaSentence[] }) {
  return (
    <span
      data-slot="page-meta-sentences"
      className="flex min-w-0 flex-1 basis-0 flex-wrap items-center gap-x-4.5 overflow-hidden leading-5.5"
    >
      {sentences.map((sentence, index) => (
        <span key={sentence.id} className={cn('inline-flex min-w-0', index > 0 && '-ml-2', sentence.muted && 'text-fg-tertiary')}>
          {index > 0 && (
            <span aria-hidden="true" data-slot="page-meta-separator" className="w-2 shrink-0">
              ·
            </span>
          )}
          <span>{sentence.text}</span>
        </span>
      ))}
    </span>
  )
}
