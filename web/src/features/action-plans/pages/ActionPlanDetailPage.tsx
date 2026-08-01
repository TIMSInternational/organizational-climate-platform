import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getActionPlan, updateActionPlan, recordProgress, type ActionPlanDetail } from '../api/actionPlans'
import ProgressUpdateForm, { type ProgressUpdateFormValues } from '../components/ProgressUpdateForm'

const STATUSES = ['not_started', 'in_progress', 'completed', 'overdue', 'cancelled']

export default function ActionPlanDetailPage() {
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [plan, setPlan] = useState<ActionPlanDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    if (!id) return
    setError(null)
    try {
      const result = await getActionPlan(baseUrl, id)
      setPlan(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load action plan')
    }
  }

  useEffect(() => {
    reload()
  }, [id])

  async function handleStatusChange(status: string) {
    if (!id) return
    setError(null)
    try {
      await updateActionPlan(baseUrl, id, { status })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  async function handleProgress(values: ProgressUpdateFormValues) {
    if (!id) return
    await recordProgress(baseUrl, id, values)
    await reload()
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!plan) {
    return <p>Loading…</p>
  }

  return (
    <div>
      <h1>{plan.title}</h1>
      <p>{plan.description}</p>
      <label>
        Status
        <select value={plan.status} onChange={(e) => handleStatusChange(e.target.value)}>
          {STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>

      <h2>KPIs</h2>
      <ul>
        {plan.kpis.map((kpi) => (
          <li key={kpi.id}>{kpi.name}: {kpi.currentValue} / {kpi.targetValue} {kpi.unit}</li>
        ))}
      </ul>

      <h2>Objectives</h2>
      <ul>
        {plan.objectives.map((objective) => (
          <li key={objective.id}>{objective.description} — {objective.currentStatus} ({objective.completionPercentage}%)</li>
        ))}
      </ul>

      <h2>Record progress</h2>
      <ProgressUpdateForm kpis={plan.kpis} objectives={plan.objectives} onSubmit={handleProgress} />
    </div>
  )
}
