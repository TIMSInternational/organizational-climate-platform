import { useState, type ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'
import { useTranslation } from '../../i18n'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  /** The current step's fields. */
  children: ReactNode
}

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
 * ## Announcing the block
 *
 * The error panel is `role="alert"`, so pressing Continue and having nothing move is
 * never silent. It is rendered *above* the fields rather than below the button,
 * because on a phone the button sits at the bottom of a scrolled panel and a message
 * under it is off screen at the moment it appears.
 *
 * ## Both themes
 *
 * Every surface here is a token — `bg-surface-card`, `border-line-default`,
 * `text-fg-secondary` — and the "current step" marker is `bg-accent-blue` with
 * `text-fg-on-accent`, which is the pairing `badgeVariantContrast.test.ts` already
 * pins in light and dark. The completed marker uses `text-accent-green` on the panel
 * surface rather than a green fill, so it stays legible in dark mode where a soft
 * fill loses most of its contrast.
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
  children,
}: WizardStepperProps) {
  const { t } = useTranslation()
  // Revealed by Continue, hidden again by any navigation. Not a copy of the errors
  // themselves -- those stay derived, so fixing a field updates the panel live.
  const [showErrors, setShowErrors] = useState(false)

  const current = steps[currentIndex]
  const isLast = currentIndex === steps.length - 1
  const currentErrors = current?.errors ?? []

  /** Every step before `index` is complete, so `index` is safe to jump to. */
  function isReachable(index: number): boolean {
    if (index <= currentIndex) return true
    return steps.slice(0, index).every((step) => step.errors.length === 0)
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
    <div className="flex flex-col gap-panel-gap">
      <nav aria-label={stepListLabel}>
        {/* A real ordered list: the steps have an order, and a screen reader
            announcing "list, 5 items, item 2" carries that for free. */}
        <ol className="flex list-none flex-wrap gap-inline p-0">
          {steps.map((step, index) => {
            const isCurrent = index === currentIndex
            const isComplete = step.errors.length === 0
            const reachable = isReachable(index)

            return (
              <li key={step.id}>
                <Button
                  type="button"
                  size="sm"
                  variant={isCurrent ? 'primary' : 'outline'}
                  onClick={() => goTo(index)}
                  disabled={!reachable || submitting}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {/* The tick is decoration on top of an ordinal that is already
                      there: colour alone must not be what says "done", and a green
                      dot is invisible to a third of readers with a colour-vision
                      deficiency. `text-accent-green` on the button surface rather
                      than a soft green fill, which loses most of its contrast in
                      dark mode. */}
                  {isComplete && !isCurrent ? (
                    <CheckIcon aria-hidden="true" className="size-3 text-accent-green" />
                  ) : (
                    <span aria-hidden="true" className="text-xs font-medium">
                      {index + 1}
                    </span>
                  )}
                  {step.label}
                </Button>
              </li>
            )
          })}
        </ol>
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>{current.label}</CardTitle>
          {current.description && <CardDescription>{current.description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col gap-panel-gap">
          <p className="m-0 text-sm text-fg-secondary">{progressLabel}</p>

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

          <div className="flex flex-wrap items-center gap-inline">
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
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
