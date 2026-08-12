import { useState, type ReactNode } from 'react'
import { CheckIcon, LockIcon } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Progress,
} from '../ui'

/**
 * One step of a wizard, as the owning page describes it.
 *
 * `errors` is the step's *current* validity, recomputed by the page on every render
 * from the values it holds — not a snapshot taken when the user pressed Continue.
 * That is what makes fixing a field clear the message it caused without any
 * additional wiring, and it is why this component keeps no copy of the errors.
 */
export interface WizardStep {
  /** Stable identity. Used as the React key and as the panel's `id`. */
  id: string
  /** Already-translated. Shown in the step list. */
  label: string
  /** Already-translated. Shown under the heading of the current step. */
  description?: string
  /**
   * Blocking problems with this step, already translated. Empty means complete.
   * Every entry is rendered, because "3 fields are wrong" is not an instruction.
   */
  errors: readonly string[]
}

export interface WizardStepperProps {
  steps: readonly WizardStep[]
  /** Index of the visible step. The page owns it, so it survives a re-render. */
  currentIndex: number
  onNavigate: (index: number) => void
  /** Called from the last step, once every step is error-free. */
  onSubmit: () => void
  /** Already-translated label for the final action, e.g. "Create microclimate". */
  submitLabel: string
  /** Already-translated progress line, e.g. "Step 2 of 5". */
  progressLabel: string
  /** Disables the controls while the submission is in flight. */
  submitting?: boolean
  /** Accessible name for the step list `<nav>`. Already translated. */
  stepListLabel: string
  /**
   * Anything the page wants to keep beside the step list — readings about the thing
   * being built, a mode chip, a link out. Rendered at the foot of the rail, under the
   * steps, so it shares the rail's "state of the work" job rather than competing with
   * the fields for attention. Omit it and the rail is only the steps.
   */
  aside?: ReactNode
  /** The current step's fields. */
  children: ReactNode
}

/** What the rail says about a step, and what colour it says it in. */
type StepState = 'current' | 'complete' | 'outstanding' | 'locked'

/**
 * The shell every multi-step create flow in this app shares.
 *
 * It lives in `components/` rather than in `features/microclimates/` deliberately:
 * #127 is the first wizard, #108 is the second, and a step shell copied into a second
 * feature folder is a step shell that will disagree with itself about what "Continue"
 * does. Nothing here knows what a microclimate is — the page supplies the steps, the
 * fields and the validation, and this owns only navigation and how a blocked step is
 * announced.
 *
 * ## The rail exists because "where am I / what is left" was only answerable by clicking
 *
 * The first version of this component was a wrapped row of buttons above a card, and
 * every step's state was carried by one of two things: which button was filled in, and
 * whether it had a tick. That answers "where am I" and nothing else — the *reason* a
 * step was not ticked stayed hidden until Continue was pressed on it, so finding out
 * what a wizard still wanted meant walking it. Screenshotting it also showed the row
 * taking a full-width band of its own above the card to hold five short chips, with the
 * fields below it in a 512px column beside 600px of empty panel.
 *
 * So the steps became a rail down the left: an ordinal set in the mono face with
 * tabular figures, the step's name, and a chip that states its condition in words —
 * *Complete*, *In progress*, *3 outstanding*, *Locked*. The outstanding **count** is
 * the part that did not exist before; it is the difference between a wizard that tells
 * you what it wants and one you have to interrogate. The messages themselves stay
 * behind Continue, deliberately: listing every unmet requirement of an untouched form
 * is nagging, and it is the panel's job rather than the rail's.
 *
 * Above the steps the rail carries a completion meter, `complete / total` in mono over
 * a `Progress` bar. It is a reading, so it is set like every other reading in this
 * product.
 *
 * ## Validation is the page's, gating is this component's
 *
 * The page recomputes `errors` for every step on every render. This component decides
 * what that means for movement:
 *
 * - **Continue** on a step with errors does not advance. It reveals them instead.
 *   Disabling the button was considered and rejected: a disabled Continue with no
 *   visible reason is the single most common "the form is broken" support ticket, and
 *   it is unreachable for a screen-reader user who never focused the offending field.
 * - **Back** is never gated. A wizard whose earlier steps are unreachable is a form
 *   with extra clicks. Going back also hides the error panel, so the reader is not
 *   told about step 3's problems while looking at step 2.
 * - **The step list** navigates freely to any earlier step, and to a later step only
 *   when every step in between is already complete. Otherwise the list would be a way
 *   around the gate the Continue button applies.
 *
 * `Locked` in the rail is that last rule made visible: a step that still wants something
 * *and* cannot be reached yet. A step that wants nothing reads `Complete` whether or not
 * it can be opened — see `stateOf` for why that ordering matters.
 *
 * ## Announcing the block
 *
 * The error panel is `role="alert"`, so pressing Continue and having nothing move is
 * never silent. It is rendered *above* the fields rather than below the button,
 * because on a phone the button sits at the bottom of a scrolled panel and a message
 * under it is off screen at the moment it appears.
 *
 * ## Colour never states anything on its own, and here it barely states anything at all
 *
 * Every state is a `Badge` carrying a word; the tick and the padlock repeat it as
 * glyphs; the marker's tint repeats it a third time (WCAG 1.4.1). The tint is the
 * weakest of the three on purpose, and the reason is measured rather than stylistic.
 *
 * `styles/badgeVariantContrast.test.ts` documents that of `Badge`'s six variants only
 * `secondary` and `outline` clear WCAG AA in *both* palettes — `default`, `success` and
 * `warning` are an accent ink on an 8%-alpha fill of the same hue. Re-measured against
 * `tokens.css` on the surface this rail actually sits on (`--admin-bg-panel`), in light:
 * 3.40:1, 3.49:1 and 2.99:1. Every alternative reach fails the same way —
 * `--admin-accent-green` on the bare panel is 3.77:1, `--admin-accent-amber` 3.19:1, and
 * `--admin-font-on-accent` on a solid `--admin-accent-blue` is 3.74:1 light and
 * **2.49:1 dark**. There is no coloured-ink option in this token set that reads in both
 * themes.
 *
 * So the rail takes the one pairing that does: a tint under `text-fg-primary`, which
 * measures 16.2:1–17.3:1 in light and 12.0:1–13.1:1 in dark across all four marker
 * fills — the treatment `alertVariants` already uses and
 * `features/surveys/respondContrast.test.ts` arrived at independently. The chips are
 * `outline` and `secondary` only, for exactly the reason #94's tables are.
 * `railContrast.test.ts` beside this file pins all of it.
 *
 * The visible consequence is that a light-mode rail is nearly monochrome, and that is
 * the honest rendering of these tokens: what carries the state is the filled and ringed
 * current row, the dimming of a locked one, the tick, and the outstanding count.
 */
export default function WizardStepper({
  steps,
  currentIndex,
  onNavigate,
  onSubmit,
  submitLabel,
  progressLabel,
  submitting = false,
  stepListLabel,
  aside,
  children,
}: WizardStepperProps) {
  const { t } = useTranslation()
  // Revealed by Continue, hidden again by any navigation. Not a copy of the errors
  // themselves -- those stay derived, so fixing a field updates the panel live.
  const [showErrors, setShowErrors] = useState(false)

  const current = steps[currentIndex]
  const isLast = currentIndex === steps.length - 1
  const currentErrors = current?.errors ?? []
  const completeCount = steps.filter((step) => step.errors.length === 0).length

  /** Every step before `index` is complete, so `index` is safe to jump to. */
  function isReachable(index: number): boolean {
    if (index <= currentIndex) return true
    return steps.slice(0, index).every((step) => step.errors.length === 0)
  }

  /**
   * `current` wins over everything: the step you are looking at is described by where
   * you are, not by how much of it you have filled in yet.
   *
   * Then `complete` — *before* `locked`, and that order is the fix for a real
   * contradiction the rendered rail showed. An optional step (the survey wizard's
   * audience step asks for nothing) is error-free from the start, so the meter counted it
   * and read `1/5` over "Steps complete" while nothing in the list said Complete: the
   * step was unreachable, so it read `Locked`. Calling it locked was also the less useful
   * of the two facts — "nothing is needed here" is what the reader wants, and the button
   * is disabled and dimmed either way, which is what says it cannot be opened yet.
   *
   * So `locked` now means "unfinished *and* out of reach", and the number of `complete`
   * chips is exactly the meter's numerator. Reachability still governs `disabled` on its
   * own, because a complete step can be behind an unfinished one.
   */
  function stateOf(index: number): StepState {
    if (index === currentIndex) return 'current'
    if (steps[index].errors.length === 0) return 'complete'
    return isReachable(index) ? 'outstanding' : 'locked'
  }

  function stateWord(state: StepState, outstanding: number): string {
    if (state === 'current') return t('wizard.stateCurrent')
    if (state === 'complete') return t('wizard.stateComplete')
    if (state === 'locked') return t('wizard.stateLocked')
    // Two keys rather than one with a `{count}`: `createTranslator` interpolates but
    // has no plural rules. English hides that -- "1 outstanding" and "{count}
    // outstanding" are the same string at one -- and Spanish does not: one key would
    // render "1 pendientes". `WizardStepper.test.tsx` asserts it in Spanish for exactly
    // that reason.
    return outstanding === 1
      ? t('wizard.stateOutstandingOne')
      : t('wizard.stateOutstanding', { count: outstanding })
  }

  function goTo(index: number): void {
    setShowErrors(false)
    onNavigate(index)
  }

  function handleAdvance(): void {
    if (currentErrors.length > 0) {
      setShowErrors(true)
      return
    }
    if (isLast) {
      onSubmit()
      return
    }
    goTo(currentIndex + 1)
  }

  if (!current) return null

  return (
    // Rail then panel, side by side once there is room for both and stacked before
    // that. `w-sidebar` is the shell's own 220px rail width, so the two rails line up
    // as one column of chrome rather than two arbitrary ones.
    <div className="flex flex-col gap-panel-gap lg:flex-row lg:items-start">
      <nav
        aria-label={stepListLabel}
        className="flex flex-col gap-panel-gap lg:w-sidebar lg:flex-none"
      >
        <div className="rounded-xl border border-line-light bg-surface-icon-box p-card">
          <p className="m-0 text-2xs font-semibold uppercase tracking-label text-fg-secondary">
            {progressLabel}
          </p>
          {/* A reading, so it is set like every other reading in this product: mono
              face, tabular figures. The denominator is dimmed rather than omitted --
              "3" alone is not a measurement. */}
          <p className="m-0 font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {completeCount}
            <span className="text-fg-secondary">/{steps.length}</span>
          </p>
          <p className="m-0 text-xs text-fg-secondary">{t('wizard.stepsComplete')}</p>
          <Progress
            className="mt-inline"
            value={(completeCount / steps.length) * 100}
            aria-label={t('wizard.stepsComplete')}
          />
        </div>

        {/* A real ordered list: the steps have an order, and a screen reader
            announcing "list, 5 items, item 2" carries that for free.

            A wrapping row until there is a column to be a rail in. Stacked, five
            two-line rows plus the meter and the aside put roughly 550px of chrome above
            the first field on an 820px viewport — measured in a screenshot — which is a
            scroll past the whole rail every time the step changes. Wrapped, the same
            five steps take three short rows there and one line each at 390px. */}
        <ol className="m-0 flex list-none flex-row flex-wrap gap-inline p-0 lg:flex-col lg:gap-row">
          {steps.map((step, index) => {
            const state = stateOf(index)
            const outstanding = step.errors.length

            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => goTo(index)}
                  // Reachability, not `state`: a step can be complete and still sit
                  // behind an unfinished one, and the gate is about the gap in front of
                  // it rather than about its own condition.
                  disabled={!isReachable(index) || submitting}
                  aria-current={state === 'current' ? 'step' : undefined}
                  className={cn(
                    // `h-auto` and `justify-start` are not decoration: index.css gives
                    // every bare `button` `height: var(--admin-size-control-lg)` and
                    // `justify-content: center`, which is right for the 30px controls
                    // this app is made of and wrong for a two-line row. Screenshotting
                    // the rail is what showed it — the labels and chips overflowed the
                    // fixed height and overlapped the row below, with every assertion
                    // in the suite still green, because happy-dom does no layout.
                    'flex h-auto w-auto items-center justify-start gap-inline rounded-md border p-2 text-left lg:w-full',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    state === 'current'
                      ? 'border-accent-blue-ring bg-accent-blue-subtle'
                      : 'border-transparent bg-transparent enabled:hover:bg-state-hover',
                  )}
                >
                  {/* The ordinal is a reading too, and it never goes away: the tick
                      lives in the chip beside it instead, so "which step is this"
                      and "what condition is it in" are answered in two places
                      rather than one place that has to choose.

                      `text-fg-primary` on every one of the four tints, never an
                      accent ink -- see the header. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-6 flex-none place-items-center rounded-md',
                      'font-mono text-xs font-semibold tabular-nums text-fg-primary',
                      state === 'current' && 'bg-accent-blue-soft',
                      state === 'complete' && 'bg-accent-green-soft',
                      state === 'outstanding' && 'bg-accent-amber-soft',
                      state === 'locked' && 'bg-surface-icon-box',
                    )}
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="flex min-w-0 flex-row items-center gap-inline lg:flex-col lg:items-start lg:gap-0.5">
                    <span className="whitespace-nowrap text-base font-medium text-fg-primary lg:truncate">
                      {step.label}
                    </span>
                    {/* `secondary` for the one state that is asking for something, so
                        the count is the only filled chip in the rail; `outline` for
                        the three that are not. Those are the two variants
                        `badgeVariantContrast.test.ts` clears in both themes. */}
                    <Badge variant={state === 'outstanding' ? 'secondary' : 'outline'}>
                      {state === 'complete' && <CheckIcon aria-hidden="true" />}
                      {state === 'locked' && <LockIcon aria-hidden="true" />}
                      {stateWord(state, outstanding)}
                    </Badge>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        {aside}
      </nav>

      <Card className="min-w-0 flex-1">
        <CardHeader>
          <CardTitle>{current.label}</CardTitle>
          {current.description && <CardDescription>{current.description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col gap-panel-gap">
          {showErrors && currentErrors.length > 0 && (
            <Alert variant="destructive" role="alert">
              <AlertTitle>{t('errors.validationError')}</AlertTitle>
              <AlertDescription>
                <ul className="m-0 flex list-disc flex-col gap-1 pl-4">
                  {currentErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {children}
        </CardContent>
        <CardFooter className="flex-wrap gap-inline border-t border-line-light pt-card">
          <Button
            type="button"
            variant="outline"
            onClick={() => goTo(currentIndex - 1)}
            disabled={currentIndex === 0 || submitting}
          >
            {t('common.back')}
          </Button>
          <Button type="button" variant="primary" onClick={handleAdvance} disabled={submitting}>
            {isLast ? submitLabel : t('common.next')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
