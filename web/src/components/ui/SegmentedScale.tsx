import { useRef, type KeyboardEvent } from 'react'
import { cn } from '../../lib/cn'

/**
 * The 1–5 scale as a row of segments, which is what the approved employee design
 * asks a likert or rating question with.
 *
 * ## Why this replaces the bare radio row
 *
 * The respond page renders a native `<input type="radio">` per scale point today,
 * with the two anchor words under the first two of them. A native radio is ~13px —
 * far under the 24px WCAG 2.2 target minimum, and this is the screen most people
 * answer on a phone. The design's answer is five tall segments the whole width of
 * the card, so the target is the segment rather than the dot, and the anchors sit
 * under the *ends* of the row they annotate rather than under its first two points.
 *
 * ## It is a radiogroup, not a row of toggle buttons
 *
 * The design prototype draws `aria-pressed` buttons, which is a mutually
 * unaware set of toggles: a screen reader announces "pressed" with no group, no
 * position and no count, and nothing tells the respondent that choosing 4 unchooses
 * 3. So the prototype's *look* is kept and its markup is not — `role="radiogroup"`
 * over `role="radio"` children, one tab stop, arrow keys through the points, exactly
 * what the native radios it replaces gave for free.
 *
 * `<button role="radio">` rather than styled `<input type="radio">` because a 44px
 * segment is drawn entirely by its container: an input needs `appearance-none` plus
 * a label peer to become one, and `index.css` styles inputs in the element layer
 * (`accent-color`), which that then has to fight.
 *
 * ## Presentational, controlled, and it translates nothing
 *
 * Both anchor words and the group's name arrive already translated, the same
 * contract `KpiTile` and `Chip` hold. The values it emits are the stable option
 * codes — `String(point)`, exactly what `respondAnswers.choicesFor` produces for a
 * bare numeric scale — never a label. Submitting a label is what splits one answer
 * into two across languages (#195).
 *
 * ## Colour
 *
 * The selected segment sits on `bg-accent-blue-fill`, never on `bg-accent-blue`.
 * `styles/tokens.css` states the rule and `styles/accentContrast.test.ts` measures
 * it: the on-accent ink is 5.47:1 on the fill in both themes and 3.74:1 light /
 * 2.49:1 dark on the identity accent, which is the pairing tokens.css forbids. The
 * anchors are `text-fg-secondary`, the pair `features/surveys/respondContrast.test.ts`
 * measures for "scale end labels"; `text-fg-tertiary` is 3.90:1 on this surface and
 * is banned from this page by name.
 *
 * The focus ring is the app's one global `:focus-visible` outline from `index.css`,
 * as every primitive here does — nothing sets `outline-none`, which is the only way
 * to lose it (see `buttonVariants.ts`).
 */
export interface SegmentedScaleProps {
  /** The lowest scale point, inclusive. `SurveyRespondQuestion.scaleMin`. */
  min: number
  /** The highest scale point, inclusive. `SurveyRespondQuestion.scaleMax`. */
  max: number
  /** Already-translated anchor under the low end ("Never"). Never translated here. */
  minLabel: string
  /** Already-translated anchor under the high end ("Always"). */
  maxLabel: string
  /**
   * The chosen point as the stored code, or `null` for unanswered.
   *
   * A string rather than a number so it can be handed `AnswerState.value` straight
   * from the form, and so a code that matches no point on the scale — a stale draft
   * against an edited survey — renders as unanswered instead of as a point that is
   * not offered.
   */
  value: string | null
  /** Emits the stored code of the point chosen. */
  onChange: (value: string) => void
  /**
   * Already-translated accessible name for the group. Supply this or `labelledBy`:
   * an unnamed radiogroup is announced as "group" with no indication of the
   * question it answers.
   */
  label?: string
  /** Id of the element naming the group — the question's `<legend>`, usually. */
  labelledBy?: string
  /** Whether the question must be answered. Reported as `aria-required`. */
  required?: boolean
  disabled?: boolean
  className?: string
}

/** The points of an inclusive integer scale, as the codes the server stores. */
function scalePoints(min: number, max: number): string[] {
  const points: string[] = []
  for (let point = min; point <= max; point += 1) points.push(String(point))
  return points
}

export function SegmentedScale({
  min,
  max,
  minLabel,
  maxLabel,
  value,
  onChange,
  label,
  labelledBy,
  required,
  disabled,
  className,
}: SegmentedScaleProps) {
  const segments = useRef<(HTMLButtonElement | null)[]>([])
  const points = scalePoints(min, max)

  // A scale with no points is not a control. An empty radiogroup announces a group
  // with nothing in it and takes a tab stop to say so.
  if (points.length === 0) return null

  const selected = points.indexOf(value ?? '')
  // One tab stop for the whole group, on the chosen point — or on the first point
  // when nothing is chosen yet, so the group can be reached at all.
  const tabStop = selected === -1 ? 0 : selected

  function select(index: number): void {
    const point = points[index]
    if (point === undefined) return
    onChange(point)
    // Selection follows focus, so the focus has to follow the arrow key too.
    segments.current[index]?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = points.length - 1
    let next: number
    switch (event.key) {
      // Both axes: the row is horizontal on a wide card and the WAI-ARIA radio
      // group pattern maps down/up as well, which is what a screen-reader user
      // reaches for.
      case 'ArrowRight':
      case 'ArrowDown':
        next = index === last ? 0 : index + 1
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = index === 0 ? last : index - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      default:
        return
    }
    // Only once a key is handled: preventing the default on every key would eat
    // Tab out of the group.
    event.preventDefault()
    select(next)
  }

  return (
    <div data-slot="segmented-scale" className={cn('w-full', className)}>
      <div
        role="radiogroup"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-required={required || undefined}
        aria-disabled={disabled || undefined}
        className="flex gap-1.5"
      >
        {points.map((point, index) => {
          const checked = index === selected
          return (
            <button
              key={point}
              ref={(node) => {
                segments.current[index] = node
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === tabStop ? 0 : -1}
              disabled={disabled}
              onClick={() => select(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                // 44px, not the design's 46px: the density scale is a 4px grid and
                // 46 is not on it, so it would have to be an arbitrary value that
                // `tokenDiscipline.test.ts` rejects. 44px is the WCAG 2.5.5 target
                // size, which is what the height is for.
                'h-11 flex-1 rounded-lg border',
                // The instrument rule: a reading is mono with tabular figures, so
                // the row does not shift as points are chosen. 16px because 15px is
                // not on the type scale.
                'font-mono text-xl tabular-nums',
                'transition-[background-color,border-color,color] ease-out',
                'disabled:cursor-not-allowed disabled:opacity-50',
                checked
                  ? 'border-transparent bg-accent-blue-fill font-semibold text-fg-on-accent'
                  : cn(
                      'border-line-default bg-surface-input text-fg-secondary',
                      'hover:not-disabled:border-accent-blue-ring hover:not-disabled:text-fg-primary',
                    ),
              )}
            >
              {point}
            </button>
          )
        })}
      </div>
      {/* Under the ENDS of the row, which is the whole point of the treatment — the
          design's note calls out that the anchors floating under the first two
          radios read as two unrelated labels rather than as the ends of a scale. */}
      <div className="mt-1.5 flex justify-between text-xs text-fg-secondary">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  )
}
