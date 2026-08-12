import { Lock } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import { ANONYMITY_FLOOR, PROTECTED_HATCH, isSuppressed } from './suppression'

/**
 * The anonymity floor, made visible.
 *
 * ## The principle this exists to express
 *
 * Below the floor a reading is withheld — and it is **shown as withheld, never
 * hidden**. Today a small sample renders nothing, which a reader interprets as
 * *missing data*: a gap that looks like the product failed to collect something.
 * The same cell rendered as hatched-and-locked, with the word *protected* beside
 * it, says the opposite — that a guarantee was enforced on purpose.
 *
 * That difference is the single most persuasive thing this product can put in
 * front of an HR audience, which is why the same treatment repeats on the
 * dashboard climate map, Departments, Demographic Fields and Microclimate results
 * until it is obviously a principle rather than a special case.
 *
 * ## Why the word is this component's job and not the caller's
 *
 * The word used to be composed by each caller, beside the cell, gated on the
 * caller re-deriving `isSuppressed(responses, threshold)` by hand. Four of five
 * product call sites explained the hatch somehow — three with the word or a
 * legend, one with a badge and a sentence of its own. `DepartmentList` did not,
 * and rendered a hatched, padlocked box with nothing to say what it meant.
 *
 * Worse than the drift: the caller had to get the *same* two arguments right
 * twice. A caller that threads a raised per-company `threshold` into this cell but
 * forgets it in its own `isSuppressed` call renders the word at the wrong times,
 * silently, for exactly the companies that raised their floor.
 *
 * So the word renders here, by default, and a caller opts *out*. The failure mode
 * becomes a redundant visible word — obvious in a screenshot, fixed in seconds —
 * rather than a silent blank box, which is the one thing this component exists to
 * deny.
 *
 * ## Why the count is never rendered
 *
 * `responses` decides suppression but is deliberately **not** shown, and no
 * accessible name includes it. Publishing "3 responses" for a suppressed cell
 * leaks precisely what the floor exists to protect: with a known headcount, an
 * exact sub-threshold count can re-identify people, and two adjacent cells whose
 * counts are published can be differenced. The reader is told *that* it is
 * protected and *what the floor is* — never how far under it this cell sits.
 *
 * This is also why a cell with *zero* responses gets no distinct "nothing to show"
 * state. Splitting the two would publish the withheld count by implication: "no
 * responses" versus "protected" is readable as 0 versus 1–4.
 */
export interface ProtectedCellProps {
  /**
   * How many responses are behind this reading. Compared against `threshold`;
   * never rendered and never announced.
   */
  responses: number
  /**
   * The anonymity floor. Defaults to `ANONYMITY_FLOOR` (5).
   *
   * Passed in rather than read from a constant because it is a per-company
   * setting: Company Settings can raise it, and the redesign shows it there as
   * *locked* — raising allowed, lowering refused. A component that hardcoded 5
   * would quietly disagree with a company that raised its floor to 10.
   */
  threshold?: number
  /**
   * Already-translated name for what this cell is, used to build the accessible
   * label — e.g. "Finance, psychological safety". Without it the locked cell
   * announces only "protected", which in a grid of them is unnavigable.
   */
  description?: string
  /**
   * Whether the word *protected* renders beside the padlock. Defaults to true,
   * and read the section above before setting it false.
   *
   * The honest reason to opt out is a surface that already carries the statement
   * some other way. Two do, for opposite reasons:
   *
   * - `ClimateMap` has too little room — `h-7` cells, and a dense grid repeating
   *   one word is noise. `charts.protectedLegend` explains the hatch for the whole
   *   matrix at once.
   * - `LiveOpenAnswers` has too much already — a `liveProtectedChip` badge with a
   *   padlock and the word above the panel, and `liveProtectedDescription` naming
   *   the floor in a sentence below it. A word inside the box would be the third
   *   time that panel says the same thing.
   *
   * Opting out because the word looks untidy in a tight cell is the wrong call —
   * widen the cell. A hatched box a reader has to interpret unaided is the failure
   * this component was written to prevent.
   */
  showWord?: boolean
  /** The reading, rendered only when the floor is met. */
  children: React.ReactNode
  className?: string
  /**
   * Applied only to the suppressed rendering, for grid-specific sizing.
   *
   * Sizes the hatched box alone, not the word: the word sits *beside* the box in a
   * wrapper, so a caller that sized its box for one 12px padlock keeps exactly the
   * box it asked for and the word lays out next to it.
   */
  suppressedClassName?: string
}

export default function ProtectedCell({
  responses,
  threshold = ANONYMITY_FLOOR,
  description,
  showWord = true,
  children,
  className,
  suppressedClassName,
}: ProtectedCellProps) {
  const { t } = useTranslation()

  if (!isSuppressed(responses, threshold)) {
    return <>{children}</>
  }

  const label = description
    ? t('charts.protectedCellNamed', { description, threshold })
    : t('charts.protectedCell', { threshold })

  const box = (
    <span
      // `img` with a label, rather than leaving a bare span: the hatch and the
      // padlock are the whole message, and a screen reader would otherwise get
      // an empty cell — the exact "reads as missing data" failure this component
      // exists to fix, just in a different modality.
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'flex items-center justify-center rounded border border-dashed border-line-default',
        // `text-fg-tertiary`, not `text-fg-light`: the padlock is the message, and
        // `--admin-font-light` is #999 on #f0f0f0 in light (2.0:1) and #555 on
        // #2a2a2a in dark (2.2:1) — a glyph a reader has to hunt for. #818181 is
        // the same value in both themes and clears 3:1 against both surfaces.
        'bg-surface-icon-box text-fg-tertiary',
        // The hatch is what distinguishes "withheld" from "empty" at a glance.
        // Authored as a gradient rather than an asset so it inherits the theme's
        // line colour instead of shipping two PNGs.
        //
        // Shared with `ClimateMap`'s legend key rather than written out here: the
        // two copies had already drifted onto different stripe tokens once, leaving
        // the key blank beside a hatched cell. See `PROTECTED_HATCH`.
        PROTECTED_HATCH,
        className,
        suppressedClassName,
      )}
    >
      <Lock aria-hidden="true" className="size-3" />
    </span>
  )

  if (!showWord) return box

  return (
    <span className="inline-flex items-center gap-1.5">
      {box}
      {/* `aria-hidden` because the box beside it already carries the same
          statement as its accessible name. The word is a *sibling*, not a child,
          so `role="img"` does not swallow it — without this, assistive technology
          hears "protected" twice. */}
      <span
        aria-hidden="true"
        className="text-2xs font-semibold uppercase tracking-label text-accent-amber-ink"
      >
        {t('charts.protectedWord')}
      </span>
    </span>
  )
}
