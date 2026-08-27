/**
 * Storefront primitives — the Conócete visual language, as components.
 *
 * Ported from https://conocete.timsint.com/ (read 2026-08-26). The upstream
 * page is hand-written CSS over semantic markup; this is a reimplementation
 * of the same system against `--storefront-*` in `src/styles/storefront.css`,
 * not a transcription of its markup or its copy.
 *
 * ## The traits that make it recognisable
 *
 * Four things carry the identity, and dropping any one of them makes a screen
 * stop reading as this system:
 *
 *   1. **Serif display over sans body.** The pairing IS the identity. Every
 *      display-scale string is serif; nothing else is.
 *   2. **One elevation.** `shadow-store-card`, violet-tinted, and no scale
 *      above or below it. A second shadow would be a change of system.
 *   3. **The all-caps kicker** at `0.16em`, which precedes essentially every
 *      section heading upstream and is the main vertical rhythm cue.
 *   4. **Fluid display type.** Sizes are `clamp()`ed against the viewport, so
 *      the hero is genuinely responsive rather than stepped at breakpoints.
 *
 * ## Figures
 *
 * Upstream draws every figure — bars, level scales, the factor grid — from DOM
 * and CSS alone. There is not one `<svg>` in the page. That is worth keeping:
 * the figures inherit the theme's tokens for free and re-resolve in dark mode
 * without a second palette, which an SVG fill would not.
 */

import type { ReactNode } from 'react'

import { cn } from '../../lib/cn'

/** Index into the four-way categorical ramp. */
export type RampSlot = 1 | 2 | 3 | 4

const RAMP_FILL: Record<RampSlot, string> = {
  1: 'bg-store-ramp-1',
  2: 'bg-store-ramp-2',
  3: 'bg-store-ramp-3',
  4: 'bg-store-ramp-4',
}

/**
 * Text colours are a SEPARATE scale from fills, not the same value reused.
 * Two of the four ramp fills fail AA as text (3.27:1 and 3.88:1 on white), so
 * `storefront.css` carries darkened text variants. Using a fill as a text
 * colour is the mistake this split exists to make impossible.
 */
const RAMP_TEXT: Record<RampSlot, string> = {
  1: 'text-store-ramp-1-text',
  2: 'text-store-ramp-2-text',
  3: 'text-store-ramp-3-text',
  4: 'text-store-ramp-4-text',
}

/**
 * Ring colours for the factor badge.
 *
 * The badge deliberately does NOT put a letter on a solid ramp fill. Measured
 * against a 17px letter, which is normal text and so needs 4.5:1:
 *
 *   fill            white   ink
 *   ramp-1 indigo    6.55   2.58   -> white only
 *   ramp-2 red       5.08   3.33   -> white only
 *   ramp-3 amber     3.27   5.17   -> ink only
 *   ramp-4 green     3.88   4.36   -> NEITHER passes
 *
 * No single foreground token serves all four, and the fourth has no passing
 * foreground at all. Dark is worse: its `on-accent` fails on two of the four.
 * So the fill becomes a ring and the letter takes `RAMP_TEXT`, which is >=4.5
 * on the surface in both themes by construction.
 */
const RAMP_RING: Record<RampSlot, string> = {
  1: 'border-store-ramp-1',
  2: 'border-store-ramp-2',
  3: 'border-store-ramp-3',
  4: 'border-store-ramp-4',
}

/* -------------------------------------------------------------------------
 * Type
 * ---------------------------------------------------------------------- */

/** The all-caps eyebrow that opens a section. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'font-store-sans text-[0.72rem] font-semibold uppercase',
        'tracking-store-kicker text-store-faint',
        className,
      )}
    >
      {children}
    </p>
  )
}

/** Display-scale heading. Serif, tightened, fluid. */
export function Display({
  children,
  as: Tag = 'h1',
  className,
}: {
  children: ReactNode
  as?: 'h1' | 'h2' | 'h3'
  className?: string
}) {
  const size =
    Tag === 'h1' ? 'text-store-display' : Tag === 'h2' ? 'text-store-h2' : 'text-store-h3'
  return (
    <Tag
      className={cn(
        'font-store-serif tracking-store-display text-store-fg',
        'font-normal text-balance',
        size,
        className,
      )}
    >
      {children}
    </Tag>
  )
}

/** The intro paragraph under a display heading. */
export function Lede({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        'font-store-sans text-store-lede leading-relaxed text-store-body',
        'max-w-[var(--storefront-measure)] text-pretty',
        className,
      )}
    >
      {children}
    </p>
  )
}

/** Kicker + heading, the pairing that opens every section upstream. */
export function SectionHead({
  kicker,
  title,
  lede,
  className,
}: {
  kicker: string
  title: ReactNode
  lede?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      <Kicker>{kicker}</Kicker>
      <Display as="h2">{title}</Display>
      {lede ? <Lede className="mt-1">{lede}</Lede> : null}
    </header>
  )
}

/**
 * The short accent rule under the hero.
 *
 * Decorative, so it takes the rule token rather than the control token and is
 * hidden from assistive technology — it separates, it does not inform.
 */
export function HeroRule({ className }: { className?: string }) {
  return <div aria-hidden className={cn('h-px w-16 bg-store-accent', className)} />
}

/* -------------------------------------------------------------------------
 * Containers
 * ---------------------------------------------------------------------- */

/** The one card in the system: surface, 16px, rule, single elevation. */
export function StoreCard({
  children,
  className,
  elevated = true,
}: {
  children: ReactNode
  className?: string
  elevated?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-store-card border border-store-rule bg-store-surface p-6',
        elevated && 'shadow-store-card',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Pill tag. */
export function Chip({
  children,
  slot,
  className,
}: {
  children: ReactNode
  slot?: RampSlot
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-store-rule',
        'bg-store-ground px-3 py-1 font-store-sans text-[0.75rem] font-semibold',
        slot ? RAMP_TEXT[slot] : 'text-store-body',
        className,
      )}
    >
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------------
 * Figures — DOM and CSS only, no SVG
 * ---------------------------------------------------------------------- */

/**
 * A labelled horizontal meter.
 *
 * Carries `role="img"` with a text label rather than `progressbar`: this
 * reports a measured score, not the progress of a task, and a screen reader
 * announcing "progress" for a climate dimension would be wrong.
 */
export function MeterBar({
  label,
  value,
  max = 100,
  slot = 1,
  className,
}: {
  label: string
  value: number
  max?: number
  slot?: RampSlot
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-4 font-store-sans">
        <span className="text-[0.82rem] font-semibold text-store-heading">{label}</span>
        <span className={cn('text-[0.82rem] font-bold tabular-nums', RAMP_TEXT[slot])}>
          {value}
          <span className="text-store-faint">/{max}</span>
        </span>
      </div>
      <div
        role="img"
        aria-label={`${label}: ${value} de ${max}`}
        className="h-2 w-full overflow-hidden rounded-full bg-store-rule-soft"
      >
        <div className={cn('h-full rounded-full', RAMP_FILL[slot])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * The four-way factor grid: a lettered dot, a tag and a short gloss.
 *
 * Upstream this names psychometric factors and the letters are meaningful. The
 * component takes whatever letter and label it is given, because in this
 * product the four slots are climate dimensions — the shape carries over, the
 * taxonomy does not.
 */
export function FactorGrid({
  items,
  className,
}: {
  items: { letter: string; tag: string; gloss: string; slot: RampSlot }[]
  className?: string
}) {
  return (
    <ul className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}>
      {items.map((item) => (
        <li key={item.tag}>
          <StoreCard className="flex h-full flex-col gap-3 p-5">
            <span
              aria-hidden
              className={cn(
                'flex size-9 items-center justify-center rounded-full border-2',
                'bg-store-surface font-store-serif text-[1.05rem]',
                RAMP_RING[item.slot],
                RAMP_TEXT[item.slot],
              )}
            >
              {item.letter}
            </span>
            <h3 className="font-store-sans text-[0.95rem] font-bold text-store-fg">{item.tag}</h3>
            <p className="font-store-sans text-[0.85rem] leading-relaxed text-store-body">
              {item.gloss}
            </p>
          </StoreCard>
        </li>
      ))}
    </ul>
  )
}

/**
 * A discrete level scale — the upstream `levels` figure.
 *
 * Both strings per step arrive as props. An earlier draft built the ordinal
 * caption inline as `Nivel ${i + 1}`, which is user-facing copy hardcoded into
 * a shipped component; `i18n/noHardcodedStrings.test.ts` does not catch it
 * because it does not descend into template literals that have substitutions.
 * Passing it in keeps the component free of copy in any language.
 */
export function LevelScale({
  levels,
  active,
  className,
}: {
  levels: { label: string; caption: string }[]
  active: number
  className?: string
}) {
  return (
    <ol className={cn('flex flex-wrap items-stretch gap-2', className)}>
      {levels.map((level, i) => {
        const isActive = i === active
        return (
          <li key={level.label} className="flex-1 basis-32">
            <div
              className={cn(
                'flex h-full flex-col gap-1 rounded-store-panel border p-3',
                isActive
                  ? 'border-store-control bg-store-ground'
                  : 'border-store-rule bg-store-surface',
              )}
            >
              <span className="font-store-sans text-[0.7rem] font-semibold uppercase tracking-store-kicker text-store-faint">
                {level.caption}
              </span>
              <span
                className={cn(
                  'font-store-sans text-[0.85rem]',
                  isActive ? 'font-bold text-store-fg' : 'text-store-body',
                )}
              >
                {level.label}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Numbered steps. */
export function StepList({
  steps,
  className,
}: {
  steps: { title: string; body: string }[]
  className?: string
}) {
  return (
    <ol className={cn('grid gap-6 md:grid-cols-3', className)}>
      {steps.map((step, i) => (
        <li key={step.title} className="flex flex-col gap-3">
          <span
            aria-hidden
            className="font-store-serif text-[2.2rem] leading-none text-store-accent"
          >
            {String(i + 1).padStart(2, '0')}
          </span>
          <h3 className="font-store-sans text-[0.95rem] font-bold text-store-fg">{step.title}</h3>
          <p className="font-store-sans text-[0.85rem] leading-relaxed text-store-body">
            {step.body}
          </p>
        </li>
      ))}
    </ol>
  )
}

/** Three-column feature grid — the upstream `triptych`. */
export function Triptych({
  panels,
  className,
}: {
  panels: { title: string; body: string }[]
  className?: string
}) {
  return (
    <div className={cn('grid gap-5 md:grid-cols-3', className)}>
      {panels.map((panel) => (
        <StoreCard key={panel.title} className="flex flex-col gap-3">
          <h3 className="font-store-serif text-[1.25rem] text-store-fg">{panel.title}</h3>
          <p className="font-store-sans text-[0.85rem] leading-relaxed text-store-body">
            {panel.body}
          </p>
        </StoreCard>
      ))}
    </div>
  )
}

/**
 * The accent call-to-action.
 *
 * A native `<button>`, so it inherits the app's focus ring from `@layer base`
 * — the storefront ring token exists for surfaces that opt into it explicitly,
 * and overriding `outline` here would silently drop the global ring.
 */
export function StoreButton({
  children,
  onClick,
  className,
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full bg-store-accent px-6 py-3 font-store-sans text-[0.85rem]',
        'font-bold text-store-on-accent transition-colors',
        'hover:bg-store-accent-hover',
        className,
      )}
    >
      {children}
    </button>
  )
}
