import { Link } from 'react-router-dom'
import type { ActionPlan } from '../api/actionPlans'

// dueDate is a calendar date, not a moment -- the API sends it as a UTC-midnight
// instant (see actionPlans.ts's normalizeDueDate). Formatting with the *local*
// (browser) time zone would roll it back a day for anyone west of UTC, since
// UTC midnight is still "yesterday evening" there. Forcing timeZone: 'UTC' here
// makes this match the calendar date the user actually picked.
function formatDueDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString(undefined, { timeZone: 'UTC' })
}

export default function ActionPlanList({ plans }: { plans: ActionPlan[] }) {
  if (plans.length === 0) {
    return <p>No action plans found.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Due date</th>
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
