import { useTranslation } from '../../../i18n'
import { Button } from '../../../components/ui'
import { typeLabel } from '../surveyVocabulary'
import type { SurveyFiltersValue } from '../surveyFilterState'

interface SurveyFiltersProps {
  value: SurveyFiltersValue
  onChange: (value: SurveyFiltersValue) => void
  onApply: () => void
  /**
   * The types present in the current result set. `Survey.Type` is validated only as
   * non-empty on the wire (`SurveyEndpoints.CreateAsync` trims it and checks nothing
   * else), so there is no closed vocabulary to enumerate — offering the types that
   * actually exist is the only option list that cannot promise a filter matching
   * nothing.
   */
  availableTypes: readonly string[]
  disabled?: boolean
}

/**
 * Type / search, applied **server-side**.
 *
 * `GET /surveys` already filters on both, so filtering the fetched array in the
 * browser would be a second, divergent implementation of a rule the server owns —
 * and would silently disagree the moment the listing is paginated. `onApply`
 * refetches; the parent owns the request.
 *
 * ## Status is deliberately not here
 *
 * It moved to `SurveyStatusChips`, and with it to the client, for one reason the
 * server cannot supply: the chips carry a **count per status**, including the
 * statuses not being shown, and a status-filtered response contains none of the
 * rows those counts would be drawn from. `surveyListView.ts` records the full
 * argument and the two facts that make it safe (the listing is unpaginated, and a
 * chip can only emit a member of the closed `SurveyStatuses.All` set).
 * `SurveyFiltersValue.status` survives as the chips' state, so the wire shape and
 * the empty-string-means-no-filter rule are unchanged.
 *
 * ## Native `<select>`, not the `SelectField` primitive
 *
 * Two reasons, and the first is a hard blocker: `ui/select.tsx` wraps
 * `@radix-ui/react-select`, whose `Select.Item` **throws** on an empty-string value,
 * and the "no filter" option is exactly that. The blank option cannot be a sentinel
 * like `'all'` either — the client drops empty filters from the query string, while
 * `SurveyStatuses.IsValid` answers 400 for any status it does not recognise, so a
 * literal `all` on the wire is a hard error rather than "no filter". Second, the
 * primitive's own docblock says to prefer a native `<select>` for a plain list of
 * options; `index.css` already styles `select` and `label > select` in both themes.
 */
export default function SurveyFilters({
  value,
  onChange,
  onApply,
  availableTypes,
  disabled,
}: SurveyFiltersProps) {
  const { t } = useTranslation()

  return (
    <form
      // A wrapping flex row rather than an equal-column grid. Rendering it showed
      // why: a grid column stretches its child, so the submit button spanned a whole
      // third of the panel while the controls it belongs to stopped at the 32rem field
      // cap. Here each control asks for the width it needs and the button is sized by
      // its label.
      //
      // `mb-0` on each label is what makes `items-end` mean what it says. The base
      // layer gives every `label` a 12px bottom margin — right when a label IS the form
      // row and stacked with others, wrong here, because the margin is part of the
      // label's box: `items-end` then aligns the button to the bottom of the MARGIN and
      // the field sits 12px above it. Measured on the rendered page at 1440, the Filter
      // button sat 12px below the two controls it submits. The 8px flex `gap` already
      // separates the rows when they wrap, so nothing is lost by dropping it.
      className="mb-panel-gap flex flex-wrap items-end gap-inline"
      onSubmit={(event) => {
        event.preventDefault()
        onApply()
      }}
    >
      <label className="mb-0 w-full sm:w-56">
        {t('surveys.surveyType')}
        <select
          value={value.type}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, type: event.target.value })}
        >
          <option value="">{t('surveys.allTypes')}</option>
          {availableTypes.map((type) => (
            <option key={type} value={type}>
              {typeLabel(t, type)}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-0 w-full sm:w-80">
        {t('common.search')}
        <input
          type="search"
          value={value.q}
          disabled={disabled}
          placeholder={t('surveys.searchSurveys')}
          onChange={(event) => onChange({ ...value, q: event.target.value })}
        />
      </label>

      <Button type="submit" className="shrink-0" disabled={disabled}>
        {t('common.filter')}
      </Button>
    </form>
  )
}
