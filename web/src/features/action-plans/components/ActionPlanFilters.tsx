import { useTranslation } from '../../../i18n'
import {
  ACTION_PLAN_PRIORITIES,
  ACTION_PLAN_STATUSES,
  priorityLabel,
  statusLabel,
} from '../actionPlanVocabulary'

import type { ActionPlanFiltersValue } from '../actionPlanFilterState'

interface ActionPlanFiltersProps {
  value: ActionPlanFiltersValue
  onChange: (value: ActionPlanFiltersValue) => void
  /** Rows currently on screen, for the result count. */
  resultCount: number
  disabled?: boolean
}

/**
 * Status, priority and title search.
 *
 * ## One of these three is a server filter and two are not, on purpose
 *
 * `ActionPlanEndpoints.ListAsync` takes `(companyId, departmentId?, status?)`. So
 * **status** goes on the query string and the database does the work — the same
 * rule `SurveyFilters` follows, and for the same reason: reimplementing a server
 * predicate in the client is a second copy of it that can disagree.
 *
 * **Priority** and **search** have no server parameter. The honest options were to
 * omit them or to narrow in the browser, and narrowing is correct *here*
 * specifically because `ListAsync` has no `Skip`/`Take` — it returns every plan for
 * the company in one response. Client-side narrowing over a complete result set is
 * exact. The moment that endpoint grows paging this becomes "filters the current
 * page", which is the wrong answer, so it is stated rather than assumed: if you add
 * paging to `ListAsync`, these two filters must move to the server with it.
 *
 * ## No Apply button, unlike `SurveyFilters`
 *
 * That page debounces behind an explicit apply because its search box hits the
 * server on every keystroke. Here only the status select causes a request, and a
 * select change is one deliberate act rather than a stream of them, so it can fire
 * immediately. The other two controls cost nothing to apply live.
 *
 * ## Native `<select>` rather than the `SelectField` primitive
 *
 * `ui/select.tsx` wraps `@radix-ui/react-select`, whose `Select.Item` **throws** on
 * an empty-string value — and "all statuses" is exactly that. A sentinel like
 * `'all'` is not available either: the client drops empty filters from the query
 * string, so a literal `all` would reach `ListAsync` as a status to match and
 * return nothing at all. `index.css` styles bare `label > select` in both themes.
 */
export default function ActionPlanFilters({
  value,
  onChange,
  resultCount,
  disabled,
}: ActionPlanFiltersProps) {
  const { t } = useTranslation()

  return (
    <div className="mb-panel-gap flex flex-col gap-inline">
      <div className="grid items-end gap-inline md:grid-cols-3">
        <label>
          {t('common.status')}
          <select
            value={value.status}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, status: event.target.value })}
          >
            <option value="">{t('common.allStatuses')}</option>
            {ACTION_PLAN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabel(t, status)}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t('actionPlans.priority')}
          <select
            value={value.priority}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, priority: event.target.value })}
          >
            <option value="">{t('actionPlans.allPriorities')}</option>
            {ACTION_PLAN_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priorityLabel(t, priority)}
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
            placeholder={t('actionPlans.searchActionPlans')}
            onChange={(event) => onChange({ ...value, q: event.target.value })}
          />
        </label>
      </div>

      {/* Live count, because two of the three filters apply without a request and
          without one there is no feedback that typing did anything at all. */}
      <p aria-live="polite" className="mb-0 text-sm text-fg-secondary">
        {t('actionPlans.planCount', { count: resultCount })}
      </p>
    </div>
  )
}
