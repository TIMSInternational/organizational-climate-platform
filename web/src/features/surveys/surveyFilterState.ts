/**
 * The survey listing's filter state, kept out of `components/SurveyFilters.tsx`.
 *
 * A `.ts` module rather than an export from the component, because oxlint's
 * `react(only-export-components)` fires on a *value* exported alongside a component
 * and the web lint budget is `--max-warnings 10` with zero headroom. The type alone
 * would have been fine — types are erased and the rule ignores them — but
 * `EMPTY_SURVEY_FILTERS` is a real binding, so both move together to keep the pair
 * in one place.
 *
 * Every member is the empty string rather than a sentinel like `'all'`, and that is
 * load-bearing: the API client drops empty values from the query string, while
 * `SurveyStatuses.IsValid` answers **400** for any status it does not recognise. So
 * an `'all'` on the wire would be a hard error rather than "no filter".
 */
export interface SurveyFiltersValue {
  status: string
  type: string
  q: string
}

export const EMPTY_SURVEY_FILTERS: SurveyFiltersValue = { status: '', type: '', q: '' }
