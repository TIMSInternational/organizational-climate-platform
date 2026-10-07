import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription } from '../../../components/ui'
import type { SurveyRespondDemographicField } from '../api/surveyResponses'

/**
 * One demographic question a respondent with no account answers about themselves,
 * before the first survey question.
 *
 * ## Why this is not `RespondQuestionField`
 *
 * It renders the same card, the same `<fieldset>`/`<legend>` pair and the same radio
 * cells, and it is deliberately a second component rather than a branch inside that
 * one. `RespondQuestionField` is driven by `SurveyQuestionDto` — a question id, a
 * type, a scale with its two anchor words, ranking entries, a comment prompt — and a
 * demographic has none of those. Threading an alternative shape through it would mean
 * every one of its branches growing an "or the demographic case" arm, on the component
 * that renders the thing this product exists to collect. The markup these two share is
 * the card and the radio cell, which are classes, and classes are the cheap thing to
 * repeat.
 *
 * ## Radios, or a dropdown
 *
 * Radios up to {@link RADIO_CEILING} options and a native `<select>` above it. Both are
 * one tap on a phone; the difference is vertical room. The respond page shows one
 * question per screen with the anonymity promise open above it (~148px of an 844px
 * fold, measured on the TIMS instrument), and a list long enough to push the way-on
 * button under the fold turns every answer into a scroll-and-hunt. A company that
 * configures ten areas — which is the shape Federico asked for — gets the dropdown.
 *
 * A native `<select>` and not a listbox built here: it gives the platform's own picker
 * on a phone, which is a full-screen wheel on iOS and a sheet on Android, and no
 * keyboard, focus or announcement behaviour has to be re-implemented to get there.
 *
 * ## "Prefiero no decir" is an option, not a skipped screen
 *
 * A field the admin left optional offers declining as a choice beside the real ones,
 * so the respondent makes a deliberate decision rather than discovering that the way
 * on works without touching anything. It submits an empty value, which
 * `DemographicValueValidation` already treats as clearing the answer, so no row is
 * written and no new server behaviour was invented to carry it. A required field does
 * not offer it: whether a field may be declined is the admin's call, taken on the
 * field, and this screen does not get to overrule it.
 *
 * ## Every control emits the stable option VALUE
 *
 * Never the label the respondent read (#195), for the reason `RespondQuestionField`
 * records: the same answer given in Spanish and in English would otherwise become two
 * unrelated groups that reconcile by row count and disagree by meaning.
 */

/** The longest option list that still reads as a list rather than a scroll. */
export const RADIO_CEILING = 6

/** The value a declined optional field submits. Empty clears the answer server-side. */
export const DECLINED = ''

export default function RespondDemographicField({
  field,
  position,
  total,
  value,
  invalid,
  disabled,
  onChange,
}: {
  field: SurveyRespondDemographicField
  position: number
  total: number
  /** The chosen option value, {@link DECLINED} for a declined field, or undefined for untouched. */
  value: string | undefined
  invalid: boolean
  disabled: boolean
  onChange: (next: string) => void
}) {
  const { t } = useTranslation('surveyRespond')

  const fieldId = `demographic-${field.field}`
  const legendId = `${fieldId}-legend`
  const errorId = `${fieldId}-error`
  const label = field.label ?? field.field

  // Declining is a choice on the same list as the real options, so it is reachable by
  // the same arrow keys and reads in the same pass.
  const choices = field.required
    ? field.options
    : [...field.options, { value: DECLINED, label: t('demographics.preferNotToSay') }]

  return (
    <fieldset
      id={fieldId}
      // Focusable only programmatically, exactly as a question is: the page moves focus
      // here when the respondent turns to this field, and when the way on finds it
      // unanswered, so they land on the question and not on a control to hunt from.
      tabIndex={-1}
      className="min-w-0 rounded-xl border border-line-default bg-surface-card p-panel shadow-sm transition-colors focus-within:border-accent-blue-ring"
    >
      {/* `float-left w-full` for `RespondQuestionField`'s reason: a `<legend>` in its
          default flow is cut out of the fieldset's border, so the question straddles the
          card's top edge and the panel reads as a 1998 form group. */}
      <legend id={legendId} className="float-left m-0 w-full p-0">
        <span className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            data-slot="demographic-index"
            className="inline-flex h-6 items-center rounded-lg border border-line-default bg-surface-icon-box px-2 font-mono text-respond-sm font-medium tabular-nums text-fg-secondary"
          >
            {`${position}/${total}`}
          </span>
          <span className="sr-only">{t('next.position', { position, total })}</span>
          {/* The WORD carries optionality, never a colour (WCAG 1.4.1) — the same rule
              and the same key the question card uses. */}
          {field.required ? null : (
            <span data-slot="demographic-optional" className="text-respond-sm font-normal text-fg-secondary">
              {t('next.optional')}
            </span>
          )}
        </span>
        <span
          data-slot="demographic-text"
          className="mt-3.5 block text-question font-normal text-fg-primary md:text-respond-question"
        >
          {label}
          {field.required ? <span className="sr-only"> {t('requiredMarker')}</span> : null}
        </span>
      </legend>

      <div className="clear-both pt-3.5">
        {invalid && (
          <Alert variant="destructive" role="alert" className="mb-3.5">
            <AlertDescription id={errorId}>{t('demographics.missing')}</AlertDescription>
          </Alert>
        )}

        {choices.length > RADIO_CEILING ? (
          // `aria-labelledby` and not an `aria-label`: the legend already names this
          // control, and a label would duplicate the question text in the announcement.
          <select
            id={`${fieldId}-select`}
            aria-labelledby={legendId}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            aria-required={field.required || undefined}
            disabled={disabled}
            value={value ?? ''}
            onChange={(event) => onChange(event.target.value)}
            // A bare `<select>` is NOT bare, and this cost a screenshot to find.
            // `index.css`'s element layer gives every one of them `padding: 0 12px`
            // and a FIXED `height`, not a min-height — so the `py-3` this first
            // carried did not grow the control, it shrank the content box inside a
            // height that never moved, and "Elija una opción" rendered as a clipped
            // sliver of its own top edge. Every assertion in the suite was green
            // while it did (happy-dom loads no stylesheet), exactly as `index.css`'s
            // carded `<button>` once was.
            //
            // So the element layer is left to do border, background, radius and
            // inset, and only the two things it gets wrong for this page are
            // overridden: `h-11`, because 32px is the admin shell's density and this
            // is a control an operario taps on a phone, and `text-respond`, because
            // 13px is that same shell's type scale. `ui/select.tsx` is deliberately
            // NOT used — its own doc says to prefer a native select for a plain list
            // of options, and the respond page wants the platform's own picker.
            className="h-11 w-full rounded-lg text-respond text-fg-primary"
          >
            {/* The placeholder is not a selectable answer: an untouched required field
                has to stay untouched, so the way on can refuse it rather than record
                the first option as a choice nobody made. A DECLINED option, where the
                admin allowed one, is a real entry further down the list. */}
            <option value="" disabled={field.required}>
              {field.required ? t('demographics.choose') : t('demographics.preferNotToSay')}
            </option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label ?? option.value}
              </option>
            ))}
          </select>
        ) : (
          <div className="grid gap-2">
            {choices.map((choice, index) => {
              const inputId = `${fieldId}-choice-${index}`
              const checked = value === choice.value
              return (
                // `<label>` wraps nothing: `htmlFor` makes the whole cell the hit target
                // without nesting the input.
                <span
                  key={choice.value}
                  data-slot="respond-choice"
                  data-checked={checked || undefined}
                  className={[
                    'flex min-w-0 flex-1 items-center gap-inline rounded-lg border px-3.5 py-3 transition-colors',
                    checked
                      ? 'border-accent-blue bg-surface-icon-box'
                      : 'border-line-default bg-surface-card hover:border-line-hover',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    id={inputId}
                    name={fieldId}
                    // `index.css` leaves radios at the browser's ~13px against a 16px
                    // label; sized to `size-icon` so the two line up. The hit target is
                    // the whole cell either way.
                    className="size-icon shrink-0"
                    value={choice.value}
                    checked={checked}
                    disabled={disabled}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? errorId : undefined}
                    onChange={() => onChange(choice.value)}
                  />
                  <label
                    htmlFor={inputId}
                    className="mb-0 flex min-h-control-lg flex-1 items-center gap-inline text-respond font-normal text-fg-primary md:text-respond-lg"
                  >
                    <span className="min-w-0">{choice.label ?? choice.value}</span>
                  </label>
                </span>
              )
            })}
          </div>
        )}
      </div>
    </fieldset>
  )
}
