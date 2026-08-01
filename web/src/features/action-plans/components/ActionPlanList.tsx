import { Link } from 'react-router-dom'
import type { ActionPlan } from '../api/actionPlans'

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
            <td>{new Date(plan.dueDate).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
