import { useState, type HTMLAttributes, type ReactNode } from 'react'
import { Copy, MoreHorizontal } from 'lucide-react'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../../components/ui'
import { useTranslation } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import { absoluteLink, maskedLink } from './launch'

/**
 * The reading tile the SurveyDetail and Distribution boards open with — the canvas's `.card.kpi`
 * (the same look as `ui/KpiCard`): an 11px tracked label, a 30px semibold tabular reading with
 * its unit on the same baseline, then an optional line or meter. Kept separate from `KpiCard`
 * because its testids and unit layout are pinned by the authoring tests.
 */
export function ReadingTile({
  label,
  value,
  unit,
  children,
  testId,
}: {
  label: string
  /** Null prints an em dash: a reading nobody took is never a zero. */
  value: string | number | null
  unit?: ReactNode
  children?: ReactNode
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line-panel bg-surface-card px-5 py-4.5"
    >
      {/* The canvas's `.kpi .l`: 11px uppercase, tracked, the one size allowed under 13px. */}
      <span data-slot="tile-label" className="text-2xs font-semibold uppercase leading-normal tracking-tile text-fg-label">{label}</span>
      <div className="flex flex-wrap items-baseline gap-1.5">
        {/* The canvas's `.kpi .v`: 30px semibold in the UI face with tabular figures — never a
            third (mono) typeface (typography.md › Conveying hierarchy). */}
        <span data-slot="reading" className="text-kpi-hero font-semibold leading-none tracking-display text-fg-primary tabular-nums">
          {value === null ? '—' : value}
        </span>
        {unit !== undefined && <span className="text-sm text-fg-secondary">{unit}</span>}
      </div>
      {children}
    </div>
  )
}

/** The 6px response meter under a reading. Absent, not empty, when there is no rate to draw. */
export function Meter({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className="h-1.5 overflow-hidden rounded-full bg-band-track"
    >
      <div className="h-full rounded-full bg-accent-blue" style={{ width: `${clamped}%` }} />
    </div>
  )
}

/**
 * A card's heading as the SurveyDetail artboard sets it on Ficha and Departamentos: the serif 20px
 * `h2` with no margin of its own, so the card's 10px gap is the whole distance to the rows below.
 * (`PanelHeading` in shared-next adds a 12px margin that its other screens rely on; the measured
 * shot had 22px here against the artboard's 10px.)
 */
export function CardHeading({ title }: { title: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="m-0 text-2xl">{title}</h2>
    </div>
  )
}

/** The canvas's `.card`: 12px radius, the panel hairline, no shadow — as `ui/Card` draws it. */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('rounded-xl border border-line-panel bg-surface-card', className)} {...rest}>
      {children}
    </section>
  )
}

export interface ShareLinkAction {
  label: string
  onSelect: () => void
  disabled?: boolean
}

/**
 * The share link as both artboards draw it — the address in a mono field, a copy button — with
 * `ShareLinkPanel`'s rule kept: the address shows the origin and the route and not one character
 * of the token until the reader asks, because the link is a credential and a distribution page
 * gets screen-shared. "Mostrar el enlace" prints it whole, as the artboards do; the revealed link
 * is remembered by value, so a replaced link comes back masked instead of on screen unasked.
 * `actions` adds the page's own writes (replace, delete, the QR code) to the same menu.
 */
export function ShareLinkField({
  link,
  actions = [],
  startRevealed = false,
}: {
  link: string
  actions?: ShareLinkAction[]
  /**
   * Show the address instead of the dotted mask, and put "Ocultar" on the row rather than
   * inside the overflow menu.
   *
   * The mask protects a link that happens to be on screen during a screen share. It is the
   * wrong default where reading or copying the link IS the errand — the share panel —
   * because there the first thing every administrator does is open a menu to undo it.
   *
   * The visible toggle lives on `SharePanel`, not here: hiding the address while leaving the
   * QR on screen hides nothing, because the code IS the address. One control covers both.
   */
  startRevealed?: boolean
}) {
  const { t } = useTranslation()
  const copy = (key: string) => t(`surveys.next.shareLink.${key}`)
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const [revealedLink, setRevealedLink] = useState<string | null>(startRevealed ? link : null)
  const [copied, setCopied] = useState(false)
  const revealed = revealedLink === link
  return (
    <div className="flex min-w-0 max-w-140 items-center gap-2">
      <div
        data-slot="share-link-value"
        className="flex h-8 min-w-0 flex-1 items-center overflow-hidden text-ellipsis whitespace-nowrap rounded border border-line-default bg-surface-card px-2.5 font-mono text-sm text-fg-primary"
      >
        <span className="truncate">{revealed ? absoluteLink(link, origin) : maskedLink(link, origin)}</span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={copied ? copy('copied') : copy('copy')}
        onClick={() => {
          void navigator.clipboard?.writeText(absoluteLink(link, origin)).then(() => setCopied(true))
        }}
      >
        <Copy aria-hidden="true" className="size-icon" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label={copy('menu')}>
            <MoreHorizontal aria-hidden="true" className="size-icon" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRevealedLink(revealed ? null : link)}>
            {revealed ? copy('hide') : copy('reveal')}
          </DropdownMenuItem>
          {actions.map((action) => (
            <DropdownMenuItem key={action.label} disabled={action.disabled} onSelect={action.onSelect}>
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * A translated sentence with one reading set in tabular figures, as the boards set dates inside
 * a line ("Uno programado para el <num>7 oct</num>, …"). The sentence is translated whole — the
 * reading sits where the locale puts `{date}` — and split around a sentinel that no copy holds.
 */
export function WithReading({ text, reading }: { text: (sentinel: string) => string; reading: string }) {
  const SENTINEL = '\uE000'
  const [before, after = ''] = text(SENTINEL).split(SENTINEL)
  return (
    <>
      {before}
      <span className="tabular-nums">{reading}</span>
      {after}
    </>
  )
}

/**
 * `shared-next`'s Panel as the Apple-design boards draw a card: 12px radius, the panel hairline,
 * no shadow (the canvas's `.card`). Same API, so the authoring pages swap the import only.
 */
export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('rounded-xl border border-line-panel bg-surface-card p-card', className)} {...rest}>
      {children}
    </section>
  )
}

/**
 * A card's serif heading with an optional count and a trailing aside — `shared-next`'s
 * PanelHeading with the count in the UI face's tabular figures instead of a third, mono
 * typeface (typography.md › Conveying hierarchy: minimise the number of typefaces).
 */
export function PanelHeading({ title, count, aside, id }: { title: string; count?: number; aside?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-inline">
      <h2 id={id} className="m-0 flex items-baseline gap-2 text-2xl">
        {title}
        {count !== undefined && <span className="font-sans text-sm font-normal tracking-normal text-fg-tertiary tabular-nums">{count}</span>}
      </h2>
      {aside && <div className="text-sm text-fg-tertiary">{aside}</div>}
    </div>
  )
}
