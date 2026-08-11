import { Link } from 'react-router'
import type { ActionPlan } from '../api/actionPlans'
import { useTranslation } from '../../../i18n'
import { Badge, EmptyState, Table } from '../../../components/ui'
import { priorityLabel, statusLabel } from '../actionPlanVocabulary'
import { isPastDue } from '../actionPlanRollup'

// dueDate is a calendar date, not a moment -- the API sends it as a UTC-midnight
// instant (see actionPlans.ts's normalizeDueDate). Formatting with the *local*
// (browser) time zone would roll it back a day for anyone west of UTC, since
// UTC midnight is still "yesterday evening" there. Forcing timeZone: 'UTC' here
// makes this match the calendar date the user actually picked.
function formatDueDate(dueDate: string, locale: string): string {
  return new Date(dueDate).toLocaleDateString(locale, { timeZone: 'UTC' })
}

interface ActionPlanListProps {
  plans: readonly ActionPlan[]
  /** True when a filter is narrowing the list, so "nothing here" can say why. */
  filtered?: boolean
  /**
   * Department id → name, for the **From** column. Empty while the departments
   * request is in flight, or after it fails; a plan whose department is not in it
   * says so rather than borrowing another row's answer.
   */
  departmentNames?: ReadonlyMap<string, string>
  /** Today, so a test can state which day it is. Defaults to the real clock. */
  now?: Date
}

/**
 * The action-plan listing.
 *
 * ## The **From** column, and what it can honestly say today
 *
 * The redesign's central claim about this screen is that *every plan names the
 * finding that produced it*, and links back to it. The domain agrees with that
 * claim — `ActionPlan.cs` carries `SourceSurveyId` and `SourceInsightId`, and
 * `CreateAsync` persists both from the request.
 *
 * **Neither reaches the browser.** `ActionPlanEndpoints.ListAsync` projects into
 * `ActionPlanListItem(Id, Title, CompanyId, DepartmentId, DueDate, Status,
 * Priority, CreatedAt)` and `ToDetailAsync` builds `ActionPlanDetail` without them
 * either, so there is no endpoint from which a web page could name the insight or
 * the survey. Adding one is a change to `src/`, not to this file.
 *
 * So the column shows the provenance that *is* on the wire: the department the
 * plan was raised for — one half of the climate-map cell, department without
 * dimension — linked to Departments, where that department's record lives. It is
 * deliberately not dressed up as more than that: a plan with no department reads
 * "Company-wide" rather than being left blank, and a department the listing does
 * not know reads "Department not listed" rather than silently going missing.
 *
 * ## Status and priority are translated, and both badges are low-chroma variants
 *
 * They used to render the raw wire value — `not_started`, `high` — which is
 * untranslated in English as much as in Spanish. `actionPlanVocabulary` maps them.
 *
 * The obvious variant mapping is `destructive` for a critical priority and
 * `success` for a completed plan. Every one of those variants fails WCAG AA 1.4.3
 * in at least one theme against `styles/tokens.css` — measured and tabulated in
 * `reports/components/ReportList.tsx`. Badge text is `text-xs`, so 4.5:1 applies,
 * and only `secondary` (8.15:1 light / 6.85:1 dark) and `outline` clear it in both.
 * The word carries the meaning, which is what WCAG 1.4.1 asks for regardless of
 * hue. Fixing `badgeVariants.ts` is a design-system change and not this file's to
 * make; what it does is decline to add another instance of the defect.
 *
 * ## The Actions column is gone, deliberately
 *
 * It held one "View details" link per row pointing at the same URL the row's own
 * title already points at. Two links to one place in one row is a second tab stop
 * that says nothing new, and the redesign spends that width on **From** instead.
 * The title is the link.
 *
 * ## Readings are mono, prose is not
 *
 * The due date is set in `font-mono tabular-nums` and the title and labels are
 * not. That is the redesign's one typographic rule — figures line up in a column
 * and read as measurements — and it is why the date carries the classes rather
 * than the row.
 */
export default function ActionPlanList({
  plans,
  filtered = false,
  departmentNames,
  now,
}: ActionPlanListProps) {
  const { t, locale } = useTranslation()
  const today = now ?? new Date()

  if (plans.length === 0) {
    return (
      <EmptyState
        fill
        title={t('actionPlans.noActionPlansFound')}
        description={
          filtered ? t('actionPlans.tryAdjustingFilters') : t('actionPlans.createFirstPlan')
        }
      />
    )
  }

  return (
    // `<Table>` rather than a bare `<table>`: it owns `w-full` and the
    // `overflow-x-auto` container the base layer stopped carrying in #218. Five
    // columns overflow a 320px viewport, and the container is what stops the page
    // itself scrolling sideways.
    <Table>
      <thead>
        <tr>
          <th>{t('actionPlans.planTitle')}</th>
          <th>{t('actionPlans.columnFrom')}</th>
          <th>{t('actionPlans.dueDate')}</th>
          <th>{t('actionPlans.priority')}</th>
          <th>{t('common.status')}</th>
        </tr>
      </thead>
      <tbody>
        {plans.map((plan) => {
          const departmentName = plan.departmentId
            ? (departmentNames?.get(plan.departmentId) ?? null)
            : null
          const overdue = isPastDue(plan, today)

          return (
            <tr key={plan.id}>
              <td>
                <Link to={`/action-plans/${plan.id}`} className="font-semibold">
                  {plan.title}
                </Link>
              </td>
              <td>
                {departmentName ? (
                  // The link back. `/departments` is where that department's
                  // record is; there is no deeper anchor to aim at, so this does
                  // not pretend to scroll to one.
                  <Link
                    to="/departments"
                    aria-label={t('actionPlans.fromDepartmentLabel', {
                      department: departmentName,
                    })}
                  >
                    <Badge variant="secondary">{departmentName}</Badge>
                  </Link>
                ) : (
                  <span className="text-fg-tertiary">
                    {plan.departmentId
                      ? t('actionPlans.fromUnlistedDepartment')
                      : t('actionPlans.fromCompanyWide')}
                  </span>
                )}
              </td>
              <td>
                <span className="flex flex-wrap items-baseline gap-1">
                  <span className="font-mono tabular-nums text-fg-secondary">
                    {formatDueDate(plan.dueDate, locale)}
                  </span>
                  {/* Colour never carries this alone (WCAG 1.4.1): the word is
                      the message and the red is emphasis on it. */}
                  {overdue && (
                    <span className="text-2xs font-semibold uppercase tracking-label text-accent-red">
                      {t('actionPlans.pastDue')}
                    </span>
                  )}
                </span>
              </td>
              <td>
                <Badge variant="outline">{priorityLabel(t, plan.priority)}</Badge>
              </td>
              <td>
                <Badge variant="secondary">{statusLabel(t, plan.status)}</Badge>
              </td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}
