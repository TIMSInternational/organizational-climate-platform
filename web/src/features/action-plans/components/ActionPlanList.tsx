import { Link } from 'react-router'
import type { ActionPlan } from '../api/actionPlans'
import { useTranslation } from '../../../i18n'

// dueDate is a calendar date, not a moment -- the API sends it as a UTC-midnight
// instant (see actionPlans.ts's normalizeDueDate). Formatting with the *local*
// (browser) time zone would roll it back a day for anyone west of UTC, since
// UTC midnight is still "yesterday evening" there. Forcing timeZone: 'UTC' here
// makes this match the calendar date the user actually picked.
function formatDueDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString(undefined, { timeZone: 'UTC' })
}

export default function ActionPlanList({ plans }: { plans: ActionPlan[] }) {
  const { t } = useTranslation()

  if (plans.length === 0) {
    return <p>{t('actionPlans.noActionPlansFound')}</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>{t('users.title')}</th>
          <th>{t('common.status')}</th>
          <th>{t('actionPlans.priority')}</th>
          <th>{t('actionPlans.dueDate')}</th>
        </tr>
      </thead>
      <tbody>
        {plans.map((plan) => (
          <tr key={plan.id}>
            <td><Link to={`/action-plans/${plan.id}`}>{plan.title}</Link></td>
            <td>{plan.status}</td>
            <td>{plan.priority}</td>
            <td>{formatDueDate(plan.dueDate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
