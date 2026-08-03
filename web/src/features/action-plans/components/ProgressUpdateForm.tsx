import { useEffect, useState, type FormEvent } from 'react'
import type { Kpi, Objective, KpiUpdateInput, ObjectiveUpdateInput } from '../api/actionPlans'
import { useTranslation } from '../../../i18n'

export interface ProgressUpdateFormValues {
  overallNotes: string
  kpiUpdates: KpiUpdateInput[]
  objectiveUpdates: ObjectiveUpdateInput[]
}

interface ProgressUpdateFormProps {
  kpis: Kpi[]
  objectives: Objective[]
  onSubmit: (values: ProgressUpdateFormValues) => Promise<void>
}

export default function ProgressUpdateForm({ kpis, objectives, onSubmit }: ProgressUpdateFormProps) {
  const { t } = useTranslation()
  const [overallNotes, setOverallNotes] = useState('')
  const [kpiValues, setKpiValues] = useState<Record<string, number>>(Object.fromEntries(kpis.map((k) => [k.id, k.currentValue])))
  const [objectiveStatuses, setObjectiveStatuses] = useState<Record<string, string>>(Object.fromEntries(objectives.map((o) => [o.id, o.currentStatus])))
  const [objectivePercentages, setObjectivePercentages] = useState<Record<string, number>>(Object.fromEntries(objectives.map((o) => [o.id, o.completionPercentage])))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Resync local edit state whenever the parent supplies fresh kpis/objectives
  // (e.g. after a reload following a successful progress submission), so a
  // second update in the same session starts from the latest server values
  // instead of stale pre-submission ones.
  useEffect(() => {
    setKpiValues(Object.fromEntries(kpis.map((k) => [k.id, k.currentValue])))
  }, [kpis])

  useEffect(() => {
    setObjectiveStatuses(Object.fromEntries(objectives.map((o) => [o.id, o.currentStatus])))
    setObjectivePercentages(Object.fromEntries(objectives.map((o) => [o.id, o.completionPercentage])))
  }, [objectives])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({
        overallNotes,
        kpiUpdates: kpis.map((k) => ({ kpiId: k.id, newValue: kpiValues[k.id] })),
        objectiveUpdates: objectives.map((o) => ({ objectiveId: o.id, statusUpdate: objectiveStatuses[o.id], completionPercentage: objectivePercentages[o.id] })),
      })
      setOverallNotes('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        {t('actionPlans.notes')}
        <textarea value={overallNotes} onChange={(e) => setOverallNotes(e.target.value)} required />
      </label>
      {kpis.map((kpi) => (
        <label key={kpi.id}>
          {kpi.name} ({kpi.unit})
          <input type="number" value={kpiValues[kpi.id]} onChange={(e) => setKpiValues({ ...kpiValues, [kpi.id]: Number(e.target.value) })} />
        </label>
      ))}
      {objectives.map((objective) => (
        <div key={objective.id}>
          <span>{objective.description}</span>
          <input value={objectiveStatuses[objective.id]} onChange={(e) => setObjectiveStatuses({ ...objectiveStatuses, [objective.id]: e.target.value })} />
          <input type="number" min={0} max={100} value={objectivePercentages[objective.id]} onChange={(e) => setObjectivePercentages({ ...objectivePercentages, [objective.id]: Number(e.target.value) })} />
        </div>
      ))}
      <button type="submit" disabled={submitting}>{submitting ? t('common.saving') : t('actionPlans.recordProgress')}</button>
    </form>
  )
}
