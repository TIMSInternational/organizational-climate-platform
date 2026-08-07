import { useTranslation } from '../../../i18n'
import { Button } from '../../../components/ui'
import { SURVEY_STATUSES, statusLabel, typeLabel } from '../surveyVocabulary'
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
 * Status / type / search, applied **server-side**.
 *
 * `GET /surveys` already filters on all three, so filtering the fetched array in the
 * browser would be a second, divergent implementation of a rule the server owns —
 * and would silently disagree the moment the listing is paginated. `onApply`
 * refetches; the parent owns the request.
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
      className="mb-panel-gap grid items-end gap-inline md:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault()
        onApply()
      }}
    >
      <label>
        {t('common.status')}
        <select
          value={value.status}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, status: event.target.value })}
        >
          <option value="">{t('surveys.allStatus')}</option>
          {SURVEY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(t, status)}
            </option>
          ))}
        </select>
      </label>

      <label>
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

      <label>
        {t('common.search')}
        <input
          type="search"
          value={value.q}
          disabled={disabled}
          placeholder={t('surveys.searchSurveys')}
          onChange={(event) => onChange({ ...value, q: event.target.value })}
        />
      </label>

      <Button type="submit" disabled={disabled}>
        {t('common.filter')}
      </Button>
    </form>
  )
}
