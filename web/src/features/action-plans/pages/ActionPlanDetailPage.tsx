import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { getActionPlan, updateActionPlan, recordProgress, type ActionPlanDetail } from '../api/actionPlans'
import ProgressUpdateForm, { type ProgressUpdateFormValues } from '../components/ProgressUpdateForm'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'

const STATUSES = ['not_started', 'in_progress', 'completed', 'overdue', 'cancelled']

export default function ActionPlanDetailPage() {
  const { t } = useTranslation()
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
      setError(err instanceof Error ? err.message : t('errors.generic'))
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
      setError(err instanceof Error ? err.message : t('errors.generic'))
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
    return <p>{t('common.loading')}</p>
  }

  return (
    <div>
      <PageTopBar
        title={plan.title}
        description={plan.description}
        breadcrumbs={[
          { label: t('navigation.actionPlans'), href: '/action-plans' },
          { label: plan.title },
        ]}
      />
      <label>
        {t('common.status')}
        <select value={plan.status} onChange={(e) => handleStatusChange(e.target.value)}>
          {STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>

      <h2>{t('actionPlans.kpisShort')}</h2>
      <ul>
        {plan.kpis.map((kpi) => (
          <li key={kpi.id}>{kpi.name}: {kpi.currentValue} / {kpi.targetValue} {kpi.unit}</li>
        ))}
      </ul>

      <h2>{t('actionPlans.objectives')}</h2>
      <ul>
        {plan.objectives.map((objective) => (
          <li key={objective.id}>{objective.description} — {objective.currentStatus} ({objective.completionPercentage}%)</li>
        ))}
      </ul>

      <h2>{t('actionPlans.recordProgress')}</h2>
      <ProgressUpdateForm kpis={plan.kpis} objectives={plan.objectives} onSubmit={handleProgress} />
    </div>
  )
}
