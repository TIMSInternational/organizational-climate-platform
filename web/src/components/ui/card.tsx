import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/card.tsx`, drawn since 11 Nov to the Apple
 * design's `.card` (`occ.css`): the card ground, a 1px hairline, the 12px card radius, 18px
 * above and below and 20px across, and **no shadow** — the canvas sets `--sh: none`, because
 * inside the content box a card is separated by its edge, not lifted off the page.
 *
 * The padding is split the way the legacy card split it: the vertical half on `Card`, the
 * horizontal half on each slot, so a slot can go full-bleed (a table inside a card) by
 * dropping its own `px-5`. A card that holds only a table is the canvas's `.card.flush`:
 * `<Card className="gap-0 py-0">` and no slot padding.
 *
 * `CardAction` is the legacy slot for a control in the header's top-right; it relies on
 * `CardHeader`'s grid, so it only positions correctly inside one.
 */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border border-line-panel bg-surface-card py-4.5',
        'text-fg-primary',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min items-start gap-1 px-5',
        'has-data-[slot=card-action]:grid-cols-[1fr_auto]',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The card title: the canvas's `.h` — the title serif at 20px, semibold, -0.01em. A card
 * title is one of the three places the serif is used (page title, card title, the
 * respondent's question), so it is set here rather than left to each card.
 */
export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        'font-display text-2xl font-semibold leading-tight tracking-title text-fg-primary',
        className,
      )}
      {...props}
    />
  )
}

export function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-fg-tertiary', className)}
      {...props}
    />
  )
}

export function CardAction({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center gap-inline px-5', className)}
      {...props}
    />
  )
}

export type KpiCardProps = Omit<ComponentProps<'div'>, 'children'> & {
  /** What is measured. **Already translated.** Drawn as the canvas's uppercase eyebrow. */
  label: string
  /**
   * The reading, already formatted for the locale (`84,8 %`, `412`). A node, not a number,
   * so a protected reading can be a `ProtectedState` instead of a figure — this card never
   * computes, rounds or defaults a value, and it renders nothing in place of a missing one.
   */
  value: ReactNode
  /** A unit or qualifier after the value, in the secondary ink (the canvas's `.v small`). */
  unit?: ReactNode
  /** The line under the reading — the denominator, the scope (the canvas's `.f`). */
  footnote?: ReactNode
  /** Anything between the reading and the footnote: a `Progress` meter, usually. */
  children?: ReactNode
}

/**
 * The canvas's KPI tile (`.card.kpi`): an 11px uppercase eyebrow tracked 0.08em, the reading
 * at 30px semibold in tabular figures, an optional meter, and a 13px footnote.
 *
 * 11px is the type floor, and it is legal here only because the label is uppercase and
 * tracked (the user's ruling of 11 Nov: "minimum 11px, only uppercase tracked eyebrows").
 * The reading is `tabular-nums` so a row of KPIs does not jitter as figures change.
 */
export function KpiCard({ label, value, unit, footnote, children, className, ...props }: KpiCardProps) {
  return (
    <div
      data-slot="kpi-card"
      className={cn(
        'flex min-w-0 flex-col rounded-xl border border-line-panel bg-surface-card px-5 py-4.5 text-fg-primary',
        className,
      )}
      {...props}
    >
      <p
        data-slot="kpi-label"
        className="m-0 text-2xs font-semibold uppercase tracking-tile text-fg-label"
      >
        {label}
      </p>
      <p
        data-slot="kpi-value"
        className="m-0 mt-1.5 text-kpi-hero font-semibold tracking-display tabular-nums text-fg-primary"
      >
        {value}
        {unit !== undefined && unit !== null && (
          <span className="ml-1 text-base font-medium tracking-normal text-fg-tertiary">{unit}</span>
        )}
      </p>
      {children !== undefined && children !== null && <div className="mt-2.5">{children}</div>}
      {footnote !== undefined && footnote !== null && (
        <p data-slot="kpi-footnote" className="m-0 mt-1.5 text-sm text-fg-tertiary">
          {footnote}
        </p>
      )}
    </div>
  )
}
