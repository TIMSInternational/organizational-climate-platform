import { useState, type FormEvent } from 'react'
import type { CreateKpiInput, CreateObjectiveInput } from '../api/actionPlans'
import type { ActionPlanTemplate } from '../api/actionPlanTemplates'
import { useTranslation } from '../../../i18n'

export interface ActionPlanFormValues {
  title: string
  description: string
  dueDate: string
  priority: string
  templateId?: string
  kpis: CreateKpiInput[]
  objectives: CreateObjectiveInput[]
}

const PRIORITIES = ['low', 'medium', 'high', 'critical']
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly']

const EMPTY_VALUES: ActionPlanFormValues = { title: '', description: '', dueDate: '', priority: 'medium', templateId: undefined, kpis: [], objectives: [] }

interface ActionPlanFormProps {
  templates?: ActionPlanTemplate[]
  onSubmit: (values: ActionPlanFormValues) => Promise<void>
}

export default function ActionPlanForm({ templates = [], onSubmit }: ActionPlanFormProps) {
  const { t } = useTranslation()
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
        {t('users.title')}
        <input value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} required />
      </label>
      <label>
        {t('actionPlans.description')}
        <textarea value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} required />
      </label>
      <label>
        {t('actionPlans.dueDate')}
        <input type="date" value={values.dueDate} onChange={(e) => setValues({ ...values, dueDate: e.target.value })} required />
      </label>
      <label>
        {t('actionPlans.priority')}
        <select value={values.priority} onChange={(e) => setValues({ ...values, priority: e.target.value })}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>

      {templates.length > 0 && (
        // Reference-only: selecting a template just sets templateId on the
        // create request (a one-field pass-through the backend validates and
        // records against). It does not copy the template's KPIs/objectives
        // into this form -- that auto-population is explicitly out of scope
        // for this slice.
        <label>
          {t('actionPlans.startFromTemplate')}
          <select
            value={values.templateId ?? ''}
            onChange={(e) => setValues({ ...values, templateId: e.target.value || undefined })}
          >
            <option value="">{t('actionPlans.noTemplate')}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      )}

      <h3>{t('actionPlans.kpisShort')}</h3>
      {values.kpis.map((kpi, index) => (
        <div key={index}>
          <input placeholder={t('departments.name')} value={kpi.name} onChange={(e) => updateKpi(index, { ...kpi, name: e.target.value })} />
          <input type="number" placeholder={t('dashboard.target')} value={kpi.targetValue} onChange={(e) => updateKpi(index, { ...kpi, targetValue: Number(e.target.value) })} />
          <input placeholder={t('actionPlans.unit')} value={kpi.unit} onChange={(e) => updateKpi(index, { ...kpi, unit: e.target.value })} />
          <select value={kpi.measurementFrequency} onChange={(e) => updateKpi(index, { ...kpi, measurementFrequency: e.target.value })}>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      ))}
      <button type="button" onClick={addKpi}>{t('actionPlans.addKPI')}</button>

      <h3>{t('actionPlans.objectives')}</h3>
      {values.objectives.map((objective, index) => (
        <div key={index}>
          <input placeholder={t('actionPlans.description')} value={objective.description} onChange={(e) => updateObjective(index, { ...objective, description: e.target.value })} />
          <input placeholder={t('actionPlans.successCriteria')} value={objective.successCriteria} onChange={(e) => updateObjective(index, { ...objective, successCriteria: e.target.value })} />
        </div>
      ))}
      <button type="button" onClick={addObjective}>{t('actionPlans.addObjective')}</button>

      <button type="submit" disabled={submitting}>{submitting ? t('common.creating') : t('actionPlans.createActionPlan')}</button>
    </form>
  )
}
