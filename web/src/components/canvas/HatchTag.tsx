import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { PROTECTED_HATCH } from '../charts/suppression'
import { cn } from '../../lib/cn'

/**
 * A withheld value, drawn where the number would have been: the protected hatch with a
 * lock and one word — "protegido", "protegidas". Never a zero and never a blank: a blank
 * reads as "nobody answered", which is the one thing a suppressed group must not say.
 *
 * The hatch is `PROTECTED_HATCH`, the one gradient `ProtectedCell` and the map's legend
 * share (`protectedHatch.test.ts` fails a hand-rolled copy), over the recessed ground the
 * boards paint it on (`.hatched`: stripes over `#f8f7fb`).
 */
export function HatchTag({ label, className }: { label: string; className?: string }) {
  return (
    <span
      data-protected="true"
      className={cn(
        PROTECTED_HATCH,
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md bg-surface-outer px-2 text-xs text-fg-light',
        className,
      )}
    >
      <Lock aria-hidden="true" className="size-3 shrink-0" />
      {label}
    </span>
  )
}

/**
 * A larger hatched field with a white pill in it — the boards' "Protegido hasta 5
 * respuestas" over a per-question figure, and "Las palabras aparecen aquí…" over the word
 * block. `children` is what sits under the pill (the empty columns of a figure), when
 * there is anything.
 */
export function HatchPill({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border border-line-default bg-surface-card px-2.5 py-1.5 text-sm text-fg-secondary',
        className,
      )}
    >
      <Lock aria-hidden="true" className="size-3.5 shrink-0 text-fg-tertiary" />
      {label}
    </span>
  )
}

/** A 32px square in the icon-box fill, holding one glyph — the boards' `iconbox()`. */
export function IconBox({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-icon-box text-fg-secondary [&_svg]:size-4',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** The hatched field itself: `PROTECTED_HATCH` over the recessed ground, sized by the caller. */
export function HatchField({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div data-protected="true" className={cn(PROTECTED_HATCH, 'rounded-lg bg-surface-outer', className)}>
      {children}
    </div>
  )
}
