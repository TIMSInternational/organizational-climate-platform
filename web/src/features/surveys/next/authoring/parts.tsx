import { useState, type HTMLAttributes, type ReactNode } from 'react'
import { Copy, MoreHorizontal } from 'lucide-react'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../../components/ui'
import { useTranslation } from '../../../../i18n'
import { cn } from '../../../../lib/cn'
import { absoluteLink, maskedLink } from './launch'

/**
 * The reading tile the SurveyDetail and Distribution artboards open with: a 10px tracked label,
 * a 28px mono reading with its unit on the same baseline, then an optional line or meter. The
 * canvas's own grammar (`card`, 14px by 16px of padding, 6px between rows) rather than `KpiTile`,
 * whose value row carries a change indicator these tiles never have.
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
      className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line-default bg-surface-card px-4 py-3.5 shadow-xs"
    >
      {/* `leading-normal`: the artboards' `.label` is 10px on the body's 1.5 (15px), not the type
          scale's snug 13.5px. */}
      <span data-slot="tile-label" className="text-2xs font-bold uppercase leading-normal tracking-wider text-fg-label">{label}</span>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span data-slot="reading" className="font-mono text-kpi-lg leading-none text-fg-primary tabular-nums">
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
      className="h-1.5 overflow-hidden rounded-sm bg-surface-icon-box"
    >
      <div className="h-full bg-accent-blue" style={{ width: `${clamped}%` }} />
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

/** A white card with the canvas hairline, as every artboard section draws it. */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('rounded-lg border border-line-default bg-surface-card shadow-xs', className)} {...rest}>
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
export function ShareLinkField({ link, actions = [] }: { link: string; actions?: ShareLinkAction[] }) {
  const { t } = useTranslation()
  const copy = (key: string) => t(`surveys.next.shareLink.${key}`)
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const [revealedLink, setRevealedLink] = useState<string | null>(null)
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
 * A translated sentence with one reading set in mono, as the artboards set dates inside a line
 * ("Uno programado para el <mono>7 oct</mono>, …"). The sentence is translated whole — the
 * reading sits where the locale puts `{date}` — and split around a sentinel that no copy holds.
 */
export function WithReading({ text, reading }: { text: (sentinel: string) => string; reading: string }) {
  const SENTINEL = '\uE000'
  const [before, after = ''] = text(SENTINEL).split(SENTINEL)
  return (
    <>
      {before}
      <span className="font-mono tabular-nums">{reading}</span>
      {after}
    </>
  )
}
