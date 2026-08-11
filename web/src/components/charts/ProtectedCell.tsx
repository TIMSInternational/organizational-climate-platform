import { Lock } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'

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
 * ## Why the count is never rendered
 *
 * `responses` decides suppression but is deliberately **not** shown, and no
 * accessible name includes it. Publishing "3 responses" for a suppressed cell
 * leaks precisely what the floor exists to protect: with a known headcount, an
 * exact sub-threshold count can re-identify people, and two adjacent cells whose
 * counts are published can be differenced. The reader is told *that* it is
 * protected and *what the floor is* — never how far under it this cell sits.
 */
export interface ProtectedCellProps {
  /**
   * How many responses are behind this reading. Compared against `threshold`;
   * never rendered and never announced.
   */
  responses: number
  /**
   * The anonymity floor. Defaults to 5.
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
  /** The reading, rendered only when the floor is met. */
  children: React.ReactNode
  className?: string
  /** Applied only to the suppressed rendering, for grid-specific sizing. */
  suppressedClassName?: string
}

/** Whether a reading is below the anonymity floor and must be withheld. */
export function isSuppressed(responses: number, threshold = 5): boolean {
  return responses < threshold
}

export default function ProtectedCell({
  responses,
  threshold = 5,
  description,
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

  return (
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
        'bg-surface-icon-box text-fg-light',
        // The hatch is what distinguishes "withheld" from "empty" at a glance.
        // Authored as a gradient rather than an asset so it inherits the theme's
        // line colour instead of shipping two PNGs.
        '[background-image:repeating-linear-gradient(135deg,var(--admin-border-light)_0_5px,transparent_5px_10px)]',
        className,
        suppressedClassName,
      )}
    >
      <Lock aria-hidden="true" className="size-3" />
    </span>
  )
}
