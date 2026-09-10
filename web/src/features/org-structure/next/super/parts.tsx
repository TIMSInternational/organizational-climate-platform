import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { cn } from '../../../../lib/cn'

/**
 * The per-role canvas's building blocks for the super administrator's screens, drawn
 * once so the six screens agree: the white card on the hairline (`.card` in the
 * artboards — 8px radius, `#e0dbee`, a 1px shadow), the icon box, the labelled field,
 * the recessed note, the dashed empty state and the thin bar.
 *
 * Every colour is a token (`fg-*`, `line-*`, `surface-*`, `accent-*`) — the artboard's
 * palette is exactly this app's: ink `#110a29` is `fg-primary`, `#4a3d72` is
 * `fg-secondary`, `#6e648b` `fg-tertiary`, `#8a82a5` `fg-light`, `#e0dbee`
 * `line-default`, `#eeedf6` `line-light`, `#f3f1fa` `surface-icon-box`.
 *
 * Components only: `react(only-export-components)` fails a module that exports a
 * component beside a plain value, and the lint budget has no room.
 */

/** A card with a serif heading and a quiet line of context on the right. */
export function Panel({
  heading,
  meta,
  children,
  accent = false,
  className,
  labelledBy,
}: {
  /** The heading element itself — an `<h2>` the caller ids for `labelledBy`. */
  heading?: ReactNode
  meta?: ReactNode
  children: ReactNode
  /** The ink rule on the left the canvas gives a form being edited. */
  accent?: boolean
  className?: string
  labelledBy?: string
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border border-line-default bg-surface-card px-5 py-4 shadow-sm',
        accent && 'border-l-[3px] border-l-fg-primary',
        className,
      )}
    >
      {(heading !== undefined || meta !== undefined) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {heading}
          {meta !== undefined && <span className="text-xs text-fg-tertiary">{meta}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

/** The serif section heading that sits outside a card, with its count and a note. */
export function SectionHead({
  id,
  heading,
  count,
  note,
}: {
  id: string
  heading: string
  count?: number
  note?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div className="flex items-baseline gap-2.5">
        <h2 id={id} className="m-0 text-2xl">
          {heading}
        </h2>
        {count !== undefined && <span className="font-mono text-xs text-fg-tertiary tabular-nums">{count}</span>}
      </div>
      {note !== undefined && <span className="text-xs text-fg-tertiary sm:text-right">{note}</span>}
    </div>
  )
}

export type IconBoxTone = 'neutral' | 'critical' | 'warning' | 'good'

const ICON_TONES: Readonly<Record<IconBoxTone, string>> = {
  neutral: 'bg-surface-icon-box text-fg-secondary',
  critical: 'bg-accent-red-soft text-accent-red',
  warning: 'bg-accent-amber-soft text-accent-amber-ink',
  good: 'bg-accent-green-soft text-accent-green-ink',
}

/** The square behind an icon: 32px, or 28px where the canvas draws it smaller. */
export function IconBox({
  children,
  tone = 'neutral',
  size = 'md',
}: {
  children: ReactNode
  tone?: IconBoxTone
  size?: 'sm' | 'md'
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg [&_svg]:size-4',
        size === 'sm' ? 'size-7' : 'size-8',
        ICON_TONES[tone],
      )}
    >
      {children}
    </span>
  )
}

/** A labelled control: the label, the control the caller passes, and its helper line. */
export function Field({
  fieldLabel,
  htmlFor,
  required = false,
  helper,
  children,
  className,
}: {
  fieldLabel: string
  htmlFor?: string
  required?: boolean
  helper?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="m-0 text-xs font-semibold text-fg-secondary">
        {fieldLabel}
        {required && (
          <span aria-hidden="true" className="text-accent-red">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {helper !== undefined && <div className="m-0 text-xs leading-snug text-fg-tertiary">{helper}</div>}
    </div>
  )
}

/** A card that goes somewhere: icon, name, one line of context, an arrow. */
export function LinkCard({
  to,
  icon,
  name,
  sub,
  onClick,
}: {
  to: string
  icon: ReactNode
  name: string
  sub: ReactNode
  onClick?: () => void
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex min-w-0 items-center gap-3 rounded-xl border border-line-default bg-surface-card px-3.5 py-3 text-fg-primary no-underline shadow-sm transition-colors hover:border-line-hover hover:bg-surface-card-hover hover:no-underline"
    >
      <IconBox>{icon}</IconBox>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold text-fg-primary">{name}</span>
        <span className="truncate text-2xs text-fg-tertiary">{sub}</span>
      </span>
      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-fg-secondary" />
    </Link>
  )
}

/** The recessed note: an icon, a bold lead, and the sentence it starts. */
export function Note({ icon, lead, children }: { icon: ReactNode; lead?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-surface-icon-box px-3.5 py-3 text-xs leading-normal text-fg-secondary">
      <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 [&_svg]:size-3.5">
        {icon}
      </span>
      <span>
        {lead !== undefined && <b className="font-semibold">{lead}</b>} {children}
      </span>
    </div>
  )
}

/** The dashed empty state inside a card: an honest sentence, not an empty grid. */
export function EmptyNote({ icon, heading, children }: { icon: ReactNode; heading: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3.5 rounded-xl border border-dashed border-line-default p-3.5">
      <IconBox>{icon}</IconBox>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="m-0 text-base font-semibold text-fg-primary">{heading}</p>
        <div className="m-0 text-xs text-fg-secondary">{children}</div>
      </div>
    </div>
  )
}

/** The thin progress bar the canvas puts beside a count. Decorative: the count says it. */
export function MiniBar({
  percent,
  muted = false,
  className,
}: {
  percent: number
  muted?: boolean
  className?: string
}) {
  return (
    <span aria-hidden="true" className={cn('inline-flex h-1.5 shrink-0 overflow-hidden rounded-full bg-line-light', className ?? 'w-13')}>
      <span
        className={cn('block h-full rounded-full', muted ? 'bg-fg-light' : 'bg-accent-blue')}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </span>
  )
}
