import { useState, type FormEvent } from 'react'
import type { CreateKpiInput, CreateObjectiveInput } from '../api/actionPlans'

export interface ActionPlanFormValues {
  title: string
  description: string
  dueDate: string
  priority: string
  kpis: CreateKpiInput[]
  objectives: CreateObjectiveInput[]
}

const PRIORITIES = ['low', 'medium', 'high', 'critical']
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly']

const EMPTY_VALUES: ActionPlanFormValues = { title: '', description: '', dueDate: '', priority: 'medium', kpis: [], objectives: [] }

export default function ActionPlanForm({ onSubmit }: { onSubmit: (values: ActionPlanFormValues) => Promise<void> }) {
  const [values, setValues] = useState<ActionPlanFormValues>(EMPTY_VALUES)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function addKpi() {
    setValues({ ...values, kpis: [...values.kpis, { name: '', targetValue: 0, unit: '', measurementFrequency: 'monthly' }] })
  }

  function updateKpi(index: number, kpi: CreateKpiInput) {
    setValues({ ...values, kpis: values.kpis.map((k, i) => (i === index ? kpi : k)) })
  }

  function addObjective() {
    setValues({ ...values, objectives: [...values.objectives, { description: '', successCriteria: '' }] })
  }

  function updateObjective(index: number, objective: CreateObjectiveInput) {
    setValues({ ...values, objectives: values.objectives.map((o, i) => (i === index ? objective : o)) })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
      setValues(EMPTY_VALUES)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <p role="alert">{error}</p>}
      <label>
        Title
        <input value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} required />
      </label>
      <label>
        Description
        <textarea value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} required />
      </label>
      <label>
        Due date
        <input type="date" value={values.dueDate} onChange={(e) => setValues({ ...values, dueDate: e.target.value })} required />
      </label>
      <label>
        Priority
        <select value={values.priority} onChange={(e) => setValues({ ...values, priority: e.target.value })}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>

      <h3>KPIs</h3>
      {values.kpis.map((kpi, index) => (
        <div key={index}>
          <input placeholder="Name" value={kpi.name} onChange={(e) => updateKpi(index, { ...kpi, name: e.target.value })} />
          <input type="number" placeholder="Target" value={kpi.targetValue} onChange={(e) => updateKpi(index, { ...kpi, targetValue: Number(e.target.value) })} />
          <input placeholder="Unit" value={kpi.unit} onChange={(e) => updateKpi(index, { ...kpi, unit: e.target.value })} />
          <select value={kpi.measurementFrequency} onChange={(e) => updateKpi(index, { ...kpi, measurementFrequency: e.target.value })}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" onClick={addKpi}>Add KPI</button>

      <h3>Objectives</h3>
      {values.objectives.map((objective, index) => (
        <div key={index}>
          <input placeholder="Description" value={objective.description} onChange={(e) => updateObjective(index, { ...objective, description: e.target.value })} />
          <input placeholder="Success criteria" value={objective.successCriteria} onChange={(e) => updateObjective(index, { ...objective, successCriteria: e.target.value })} />
        </div>
      ))}
      <button type="button" onClick={addObjective}>Add objective</button>

      <button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create action plan'}</button>
    </form>
  )
}
