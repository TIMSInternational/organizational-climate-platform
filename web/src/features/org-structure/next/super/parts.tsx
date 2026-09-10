import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { cn } from '../../../../lib/cn'
import { Chip, type ChipTone } from '../../../../components/ui'

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
    <div data-slot="canvas-note" className="flex items-start gap-2.5 rounded-lg bg-surface-icon-box px-3.5 py-3 text-sm leading-normal text-fg-secondary">
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
    <span aria-hidden="true" className={cn('inline-flex h-1.5 shrink-0 overflow-hidden rounded-full bg-line-default', className ?? 'w-13')}>
      <span
        className={cn('block h-full rounded-full', muted ? 'bg-fg-light' : 'bg-accent-blue')}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </span>
  )
}

/**
 * The canvas's select: a 32px field on the hairline with a lucide chevron, as every
 * artboard of the per-role canvas draws it (`.select` — `height: 32px; padding: 0 10px;
 * border: 1px solid #e0dbee; border-radius: 4px`, a 14px chevron; `fg-tertiary`, since `inkContrast.test.ts` keeps the non-text ink `fg-light` to its two exempt sites).
 *
 * Still a native `<select>` underneath — `appearance-none` only drops the browser's own
 * chevron — so it keeps the platform's keyboard and screen-reader behaviour and every
 * test that drives it with `selectOptions`. `className` sizes the wrapper (`w-full`,
 * `w-40`…); every other prop goes to the `<select>`.
 */
export function CanvasSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <span data-slot="canvas-select" className={cn('relative inline-flex min-w-0 max-w-full', className)}>
      <select
        {...props}
        className="h-control-lg w-full min-w-0 appearance-none truncate rounded-md border border-line-default bg-surface-input py-0 pl-2.5 pr-8 text-base text-fg-primary"
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        data-slot="canvas-select-chevron"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-tertiary"
      />
    </span>
  )
}

/** Each tone's hairline, as the canvas's `.chip.<tone>` draws it: the ink at 20%. */
const CHIP_BORDER: Record<ChipTone, string> = {
  good: 'border-chip-good-ink/20',
  warning: 'border-chip-warning-ink/20',
  critical: 'border-chip-critical-ink/20',
  accent: 'border-chip-accent-ink/20',
  neutral: 'border-line-default',
}

/**
 * The canvas's chip: the app's `Chip` with the hairline every `.chip` in the artboards
 * carries (`border: 1px solid` the tone's ink at 20%, `#e0dbee` when neutral). A
 * variant local to these screens, so the `Chip` primitive every other screen uses is
 * untouched.
 */
export function CanvasChip({ tone = 'neutral', className, ...props }: ComponentProps<typeof Chip> & { tone?: ChipTone }) {
  return <Chip tone={tone} data-canvas-chip={tone} className={cn(CHIP_BORDER[tone], 'font-medium', className)} {...props} />
}
