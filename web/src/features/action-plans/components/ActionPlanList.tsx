import { Link } from 'react-router'
import type { ActionPlan } from '../api/actionPlans'
import { useTranslation } from '../../../i18n'
import { Badge, EmptyState, Table } from '../../../components/ui'
import { priorityLabel, statusLabel } from '../actionPlanVocabulary'

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
}

/**
 * The action-plan listing.
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
 */
export default function ActionPlanList({ plans, filtered = false }: ActionPlanListProps) {
  const { t, locale } = useTranslation()

  if (plans.length === 0) {
    return (
      <EmptyState
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
          <th>{t('common.status')}</th>
          <th>{t('actionPlans.priority')}</th>
          <th>{t('actionPlans.dueDate')}</th>
          <th>{t('common.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {plans.map((plan) => (
          <tr key={plan.id}>
            <td>
              <Link to={`/action-plans/${plan.id}`}>{plan.title}</Link>
            </td>
            <td>
              <Badge variant="secondary">{statusLabel(t, plan.status)}</Badge>
            </td>
            <td>
              <Badge variant="outline">{priorityLabel(t, plan.priority)}</Badge>
            </td>
            <td>{formatDueDate(plan.dueDate, locale)}</td>
            <td>
              <Link to={`/action-plans/${plan.id}`}>{t('common.viewDetails')}</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
