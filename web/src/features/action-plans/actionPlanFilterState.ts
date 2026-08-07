/**
 * The action-plan list's filter state, in its own module rather than beside the
 * component that renders it.
 *
 * Same reason `surveys/surveyFilterState.ts` exists: a `.tsx` file that exports a
 * component *and* a constant trips oxlint's `react(only-export-components)`, which
 * is a real Fast Refresh limitation (the module gets a full reload rather than a
 * component swap) and is also a lint budget this repo cannot spend — `npm run lint`
 * runs at `--max-warnings 10` and the count sits within one or two of it.
 *
 * The type could have lived in the component file, since a type-only export is
 * erased and does not trip the rule. Keeping it next to its own initial value is
 * what stops the two drifting when a fourth filter is added.
 */
export interface ActionPlanFiltersValue {
  /**
   * Sent to the server. One of `ActionPlanValidation.ValidStatuses`, or `''` for no
   * filter — `ListAsync` applies this one in the database.
   */
  status: string
  /** Narrowed in the browser; `ListAsync` has no priority parameter. `''` for all. */
  priority: string
  /** Narrowed in the browser, against the plan title. */
  q: string
}

export const EMPTY_ACTION_PLAN_FILTERS: ActionPlanFiltersValue = { status: '', priority: '', q: '' }
