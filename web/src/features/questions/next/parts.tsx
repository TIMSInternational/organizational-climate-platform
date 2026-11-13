import type { ComponentProps, ReactNode } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Input } from '../../../components/ui'
import { cn } from '../../../lib/cn'

/**
 * The pieces the question bank and the question library share, drawn to the Apple design's
 * list board (Surveys.dc.html: `.card.flush` around a `.tbl`, `.in` fields, a 300px search).
 *
 * Kept here rather than in `components/ui` because they are compositions of the primitives —
 * a card around a `Table`, a native select at the `Input` primitive's height — and only these
 * four screens use them.
 */

/** The board's `.card.flush`: the table sits flush in a bordered card, no shadow. */
export const TABLE_CARD = 'overflow-hidden rounded-xl border border-line-panel bg-surface-card'

/**
 * An editor that opens inline under a list: a plain bordered card at the card radius. It no
 * longer carries the earlier 3px ink edge — the Apple boards mark nothing with a coloured edge,
 * and the serif title already says what the card is.
 */
export const EDITOR_CARD = 'flex flex-col gap-3.5 rounded-xl border border-line-panel bg-surface-card px-5 pt-4 pb-4.5'

/**
 * A native `<select>` at the `Input` primitive's 36px on the control edge (`.in` in occ.css,
 * and `ui/input.tsx`: `h-9 border-line-control`), with the thin chevron in place of the
 * platform arrow. 44px under a coarse pointer, as the Input grows. Accessible name: wrap it in a
 * `<label>` or pass `aria-label`.
 */
export function QSelect({ className, selectClassName, children, ...props }: ComponentProps<'select'> & { selectClassName?: string }) {
  return (
    <span data-slot="q-select" className={cn('relative inline-flex min-w-0 max-w-full', className)}>
      <select
        {...props}
        className={cn(
          'mt-0 h-9 w-full min-w-0 max-w-none appearance-none truncate rounded-md border border-line-control bg-surface-input py-0 pr-8 pl-3 text-base text-fg-primary pointer-coarse:h-11',
          'disabled:cursor-default disabled:bg-surface-fill-subtle disabled:text-fg-tertiary',
          selectClassName,
        )}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-fg-tertiary"
      />
    </span>
  )
}

/** The board's search field: a magnifier inside the 36px `Input`, the label read by screen readers. */
export function SearchField({
  label,
  value,
  onChange,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label className={cn('relative mb-0 block min-w-0', className)}>
      <span className="sr-only">{label}</span>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-tertiary" />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        className="mt-0 max-w-none pl-9"
      />
    </label>
  )
}

/** A count beside a name — a category's questions, say — in the secondary size and tabular figures. */
export function Count({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-sm tabular-nums text-fg-tertiary', className)}>{children}</span>
}
