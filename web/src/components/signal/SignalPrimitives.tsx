import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * A denser, quieter visual language for the admin surfaces — the "signal" direction.
 *
 * Adapted from a reference the client pointed at (aaru.com, 2026-09-21) after looking at
 * both halves of it: the marketing site and the product screens it shows. The product
 * half is what an admin tool can actually use, and it is what these primitives take:
 *
 * | Taken                                                    | Used here as                      |
 * |----------------------------------------------------------|-----------------------------------|
 * | eyebrow ——— meta over a hairline, before every section     | `SectionRule`                     |
 * | a two-line display, second line dropped to a muted ink     | `DisplayPair`                     |
 * | a dot matrix standing for a population                     | `PopulationGrid`                  |
 * | a two-column card contrasting two readings of one thing    | `ContrastCard`                    |
 * | a right rail of label → value rows                         | `FactRail`                        |
 * | grey ordinals down the left of an enumerated list          | `OrdinalList`                     |
 * | pill tabs, and ONE small accent action per screen          | `PillTabs`, and the `ui` Button   |
 *
 * **Not** taken: the electric-blue brand field, the circular photo lenses, the mark, or
 * any of its copy. Those are that company's identity; borrowing them would put someone
 * else's brand on a client deliverable. What is borrowed is layout, density and restraint.
 *
 * Every colour and measure is a token from `styles/tokens.css`, so the whole set flips
 * with the theme. `components/ui/tokenDiscipline.test.ts` does not sweep this directory,
 * but the rule it enforces is the reason this file has no raw value in it: a hardcoded
 * colour looks right in light and collapses in dark, which is the failure mode a design
 * language introduces most easily.
 *
 * Copy is never authored here. Every string is a prop, so the caller resolves it through
 * `t()` and `i18n/noHardcodedStrings.test.ts` stays satisfied.
 */

/** The letterspaced small-caps label that opens a section or names a field. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('text-2xs font-bold uppercase tracking-eyebrow text-fg-label', className)}>{children}</span>
  )
}

/**
 * A label on the left, a meta note on the right, a hairline under both.
 *
 * The reference uses this before every band of content, and it is what gives a long page
 * its rhythm without a heading competing with the one below it.
 *
 * ## `labelAs`
 *
 * `'eyebrow'` sets the label itself in small caps — right on a surface whose sections are
 * not headings. `'plain'` renders whatever it is given untouched, which is what a real
 * screen needs: the dashboard's sections carry `<h2 id>` elements that `aria-labelledby`
 * and several tests point at, and dissolving those into decorative spans would trade an
 * accessibility guarantee for a typeface. The rule and the meta are the part worth having;
 * the heading stays a heading.
 */
export function SectionRule({
  label,
  meta,
  labelAs = 'eyebrow',
  metaAs = 'eyebrow',
}: {
  label: ReactNode
  meta?: ReactNode
  labelAs?: 'eyebrow' | 'plain'
  /** `'plain'` when the right side is already styled — a legend, or a link with its arrow. */
  metaAs?: 'eyebrow' | 'plain'
}) {
  return (
    <div data-slot="signal-rule" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {labelAs === 'plain' ? label : <Eyebrow>{label}</Eyebrow>}
        {meta !== undefined &&
          (metaAs === 'plain' ? meta : <Eyebrow className="text-fg-tertiary">{meta}</Eyebrow>)}
      </div>
      <hr className="m-0 h-px w-full border-0 bg-line-default" />
    </div>
  )
}

/**
 * Two lines of display type, the second dropped to the muted ink.
 *
 * The drop is the whole device: it reads as one sentence continuing rather than two
 * headings, and it lets a section state a fact and its consequence without a paragraph.
 */
export function DisplayPair({ lead, trail }: { lead: ReactNode; trail?: ReactNode }) {
  return (
    <h2 data-slot="signal-display" className="m-0 text-3xl tracking-tight">
      <span className="block text-fg-primary">{lead}</span>
      {trail !== undefined && <span className="block text-fg-tertiary">{trail}</span>}
    </h2>
  )
}

export interface PopulationBand {
  /** The group's own name — payload content, never UI copy. */
  name: string
  /** Respondents in the group. Ignored entirely when `isProtected`. */
  responses: number
  /** Under the floor: this row may yield no count, by any channel. */
  isProtected: boolean
}

/** How wide a withheld band is drawn. A constant, and that is the point — see below. */
const WITHHELD_DOTS = 7

/** Above this, a disclosed row draws a bar rather than counting out dots. */
const MAX_DOTS = 40

/**
 * A population drawn as one dot per respondent, group by group.
 *
 * ## The trap this primitive exists to not fall into
 *
 * A dot per respondent **is** the count. Drawing `responses` dots for a group under the
 * privacy floor discloses its headcount exactly as surely as printing the number — a
 * reader counts four dots and knows there are four people, which is the disclosure the
 * floor of 5 exists to prevent. It would also pass every test that checks no *number* is
 * rendered, because the leak is in the geometry, not the text.
 *
 * So a protected band draws a CONSTANT `WITHHELD_DOTS` hatched marks and no count. The
 * row still exists and is still named — absent and withheld are different statements, the
 * same rule the rest of this codebase applies — but its width carries no information.
 *
 * A disclosed group over `MAX_DOTS` draws a proportional bar instead, because a hundred
 * dots stops being countable and starts being texture.
 */
export function PopulationGrid({
  bands,
  protectedLabel,
  className,
}: {
  bands: readonly PopulationBand[]
  /** Already-translated word for a withheld row, e.g. "protegido". */
  protectedLabel: string
  className?: string
}) {
  const widest = Math.max(1, ...bands.filter((band) => !band.isProtected).map((band) => band.responses))
  return (
    <div data-slot="signal-population" className={cn('flex flex-col gap-3', className)}>
      {bands.map((band) => (
        <div key={band.name} className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-3">
          <span className="truncate text-sm text-fg-secondary" title={band.name}>
            {band.name}
          </span>
          {band.isProtected ? (
            <span
              data-slot="population-withheld"
              data-protected="true"
              className="flex flex-wrap items-center gap-1"
              aria-label={`${band.name} — ${protectedLabel}`}
            >
              {Array.from({ length: WITHHELD_DOTS }, (_, index) => (
                <span
                  key={index}
                  aria-hidden="true"
                  // A text-grade ink, not a line token: `border-line-hover` is tuned for
                  // dividers and went nearly invisible against the dark surface, and this
                  // mark is the one that says a group is withheld. It has to be seen.
                  className="size-2 rounded-full border border-dashed border-fg-tertiary bg-transparent"
                />
              ))}
            </span>
          ) : band.responses > MAX_DOTS ? (
            <span data-slot="population-bar" className="block h-2 w-full overflow-hidden rounded-full bg-surface-icon-box">
              <span
                className="block h-full rounded-full bg-accent-blue"
                style={{ width: `${Math.max((band.responses / widest) * 100, 2)}%` }}
              />
            </span>
          ) : (
            <span data-slot="population-dots" className="flex flex-wrap items-center gap-1">
              {Array.from({ length: band.responses }, (_, index) => (
                <span key={index} aria-hidden="true" className="size-2 rounded-full bg-accent-blue" />
              ))}
            </span>
          )}
          {/* The count, or the word — never both, and never a 0 standing in for the word. */}
          {band.isProtected ? (
            <span className="text-xs text-fg-tertiary">{protectedLabel}</span>
          ) : (
            <span className="font-mono text-sm tabular-nums text-fg-primary">{band.responses}</span>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * One thing, read two ways, side by side — the reference's strongest card.
 *
 * It sets the weaker reading in muted ink on the left and the one that carries the point
 * in full ink under an accented label on the right, then closes with a single consequence
 * line. For this product the two sides are two waves, or a stated intention against a
 * measured result.
 */
export function ContrastCard({
  question,
  leftLabel,
  left,
  rightLabel,
  right,
  outcomeLabel,
  outcome,
  action,
}: {
  question: ReactNode
  leftLabel: ReactNode
  left: ReactNode
  rightLabel: ReactNode
  right: ReactNode
  outcomeLabel: ReactNode
  outcome: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      data-slot="signal-contrast"
      className="flex flex-col gap-4 rounded-lg border border-line-default bg-surface-card px-5 py-4.5 shadow-xs"
    >
      <Eyebrow>{question}</Eyebrow>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
        <div className="flex flex-col gap-1.5">
          <Eyebrow className="text-fg-tertiary">{leftLabel}</Eyebrow>
          <p className="m-0 text-base text-fg-tertiary">{left}</p>
        </div>
        {/* The accent appears once, on the label of the side that carries the finding. */}
        <div className="flex flex-col gap-1.5 sm:border-l sm:border-line-light sm:pl-6">
          <Eyebrow className="text-accent-blue">{rightLabel}</Eyebrow>
          <p className="m-0 text-base text-fg-primary">{right}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-t border-line-light pt-3.5">
        <p className="m-0 text-sm text-fg-secondary">
          <Eyebrow className="mr-2">{outcomeLabel}</Eyebrow>
          {outcome}
        </p>
        {action}
      </div>
    </div>
  )
}

/** One label → value row of a `FactRail`. `value` is content; `label` is copy. */
export interface Fact {
  label: ReactNode
  value: ReactNode
}

/**
 * A rail of label → value rows under a heading, as the reference's Properties panel.
 *
 * Deliberately not a table: these are attributes of one thing, and a table would promise
 * that the rows are comparable to each other.
 */
export function FactRail({
  heading,
  facts,
  className,
}: {
  heading: ReactNode
  facts: readonly Fact[]
  className?: string
}) {
  return (
    <div
      data-slot="signal-rail"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-line-default bg-surface-card px-4 py-3.5 shadow-xs',
        className,
      )}
    >
      <Eyebrow>{heading}</Eyebrow>
      <dl className="m-0 flex flex-col gap-2.5">
        {facts.map((fact, index) => (
          <div key={index} className="flex items-baseline justify-between gap-3">
            <dt className="m-0 shrink-0 text-sm text-fg-label">{fact.label}</dt>
            <dd className="m-0 min-w-0 text-right text-sm text-fg-primary">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * An enumerated list with its ordinals set quiet and monospaced down the left.
 *
 * The ordinal is `aria-hidden`: an ordered list already announces position, and a screen
 * reader saying "one, one, Reponer la reunión" is the kind of double-reading that makes
 * people turn the thing off.
 */
export function OrdinalList({ items }: { items: readonly ReactNode[] }) {
  return (
    <ol data-slot="signal-ordinals" className="m-0 flex list-none flex-col gap-2.5 p-0">
      {items.map((item, index) => (
        <li key={index} className="grid grid-cols-[1.5rem_1fr] items-baseline gap-2">
          <span aria-hidden="true" className="font-mono text-xs tabular-nums text-fg-tertiary">
            {index + 1}
          </span>
          <span className="text-sm text-fg-secondary">{item}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * Pill tabs — the active one filled rather than underlined.
 *
 * Presentational: this renders the RESTING appearance of a tab set for a design surface
 * to be photographed, so it draws no `<button>` and takes no handler. A live tab set is
 * `components/ui/tabs.tsx`, which is Radix-backed and keyboard-operable; this must not
 * grow into a second, worse one.
 */
export function PillTabs({ tabs, activeIndex = 0 }: { tabs: readonly ReactNode[]; activeIndex?: number }) {
  return (
    <div data-slot="signal-tabs" className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-surface-outer p-1">
      {tabs.map((tab, index) => (
        <span
          key={index}
          data-active={index === activeIndex ? 'true' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm',
            index === activeIndex ? 'bg-surface-card text-fg-primary shadow-xs' : 'text-fg-secondary',
          )}
        >
          {tab}
        </span>
      ))}
    </div>
  )
}

/**
 * A card with a quiet header: an eyebrow, an optional count, and room for an action.
 *
 * The count sits beside the label rather than in the body, which is what lets a grid of
 * these be scanned for "how much is in each" without reading any of them.
 */
export function QuietCard({
  label,
  count,
  action,
  children,
  className,
}: {
  label: ReactNode
  count?: number
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      data-slot="signal-card"
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-lg border border-line-default bg-surface-card px-4 py-3.5 shadow-xs',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-baseline gap-2">
          <Eyebrow>{label}</Eyebrow>
          {count !== undefined && (
            <span className="font-mono text-xs tabular-nums text-fg-tertiary">{count}</span>
          )}
        </span>
        {action}
      </div>
      {children}
    </section>
  )
}
