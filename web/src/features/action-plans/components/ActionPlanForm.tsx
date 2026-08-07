import { useState, type FormEvent } from 'react'
import type { CreateKpiInput, CreateObjectiveInput } from '../api/actionPlans'
import type { ActionPlanTemplate } from '../api/actionPlanTemplates'
import { useTranslation } from '../../../i18n'
import {
  ACTION_PLAN_PRIORITIES,
  MEASUREMENT_FREQUENCIES,
  frequencyLabel,
  priorityLabel,
} from '../actionPlanVocabulary'
import {
  Alert,
  AlertDescription,
  Button,
  H3,
  SelectField,
  Separator,
  TextField,
  TextareaField,
} from '../../../components/ui'

export interface ActionPlanFormValues {
  title: string
  description: string
  dueDate: string
  priority: string
  templateId?: string
  kpis: CreateKpiInput[]
  objectives: CreateObjectiveInput[]
}

/**
 * A KPI as the *form* holds it: `targetValue` is a string.
 *
 * Not a cosmetic difference. With a `number` in state, a controlled numeric input
 * initialised to `0` cannot be cleared — every keystroke runs through `Number('')`,
 * which is `0`, so the field snaps back and typing "12" produces "012". Holding the
 * raw text and converting once at submit is what makes the field behave.
 */
interface KpiDraft {
  name: string
  targetValue: string
  unit: string
  measurementFrequency: string
}

/**
 * Radix's `Select.Item` throws on an empty-string value, and "no template" is
 * semantically empty. A sentinel keeps the primitive usable; it is form-local and
 * is mapped back to `undefined` before anything is sent.
 */
const NO_TEMPLATE = '__none__'

const EMPTY_KPI: KpiDraft = { name: '', targetValue: '', unit: '', measurementFrequency: 'monthly' }
const EMPTY_OBJECTIVE: CreateObjectiveInput = { description: '', successCriteria: '' }

interface ActionPlanFormProps {
  templates?: ActionPlanTemplate[]
  onSubmit: (values: ActionPlanFormValues) => Promise<void>
  onCancel?: () => void
}

/**
 * The create form.
 *
 * ## What it validates, and why it validates anything at all
 *
 * `CreateAsync` checks three things: title and description non-blank, priority in
 * `ValidPriorities`, and every KPI's frequency in `ValidMeasurementFrequencies`.
 * The pickers make the last two unfailable, so the interesting case is what the
 * server does **not** check — it will happily persist a KPI named `""` with a
 * target of 0, or an objective with an empty description, because
 * `request.Kpis`/`request.Objectives` are taken as given. Those rows are then
 * permanent: there is no delete endpoint for a KPI or an objective. So the blank
 * rows are rejected here, where the user can still fix them, rather than written to
 * a table nothing can clean up.
 *
 * Server-side errors are still surfaced verbatim (see the `Alert` below) rather
 * than pre-empted — the client does not restate `CreateAsync`'s rules, it only adds
 * the ones `CreateAsync` has none of.
 */
export default function ActionPlanForm({ templates = [], onSubmit, onCancel }: ActionPlanFormProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<string>('medium')
  const [templateId, setTemplateId] = useState<string>(NO_TEMPLATE)
  const [kpis, setKpis] = useState<KpiDraft[]>([])
  const [objectives, setObjectives] = useState<CreateObjectiveInput[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function updateKpi(index: number, patch: Partial<KpiDraft>) {
    setKpis((current) => current.map((kpi, i) => (i === index ? { ...kpi, ...patch } : kpi)))
  }

  function updateObjective(index: number, patch: Partial<CreateObjectiveInput>) {
    setObjectives((current) =>
      current.map((objective, i) => (i === index ? { ...objective, ...patch } : objective)),
    )
  }

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {}
    if (!title.trim()) errors.title = t('validation.required')
    if (!description.trim()) errors.description = t('validation.required')
    if (!dueDate) errors.dueDate = t('validation.required')
    kpis.forEach((kpi, index) => {
      if (!kpi.name.trim()) errors[`kpi-${index}`] = t('validation.required')
      else if (kpi.targetValue.trim() === '' || !Number.isFinite(Number(kpi.targetValue))) {
        errors[`kpi-${index}`] = t('validation.invalidNumber')
      }
    })
    objectives.forEach((objective, index) => {
      if (!objective.description.trim()) errors[`objective-${index}`] = t('validation.required')
    })
    return errors
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        dueDate,
        priority,
        templateId: templateId === NO_TEMPLATE ? undefined : templateId,
        kpis: kpis.map((kpi) => ({
          name: kpi.name.trim(),
          targetValue: Number(kpi.targetValue),
          unit: kpi.unit.trim(),
          measurementFrequency: kpi.measurementFrequency,
        })),
        objectives: objectives.map((objective) => ({
          description: objective.description.trim(),
          successCriteria: objective.successCriteria.trim(),
        })),
      })
    } catch (err) {
      // The parent reloads and closes the form on success, so this component is
      // unmounted before the state below could matter. On failure it stays mounted
      // with everything the user typed still in it.
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="flex flex-col gap-panel-gap" onSubmit={handleSubmit} noValidate>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <TextField
        label={t('actionPlans.planTitle')}
        required
        value={title}
        onChange={setTitle}
        error={fieldErrors.title}
        placeholder={t('actionPlans.planTitlePlaceholder')}
      />

      <TextareaField
        label={t('actionPlans.description')}
        required
        rows={3}
        value={description}
        onChange={setDescription}
        error={fieldErrors.description}
        placeholder={t('actionPlans.descriptionPlaceholder')}
      />

      <div className="grid gap-inline md:grid-cols-2">
        {/* Native `type="date"`, deliberately: `ui/date-picker.tsx`'s own docblock
            records that this form is one of the two it leaves on a native input,
            because a native input is the better default when one will do. */}
        <label>
          {t('actionPlans.dueDate')}
          <input
            type="date"
            value={dueDate}
            required
            aria-invalid={fieldErrors.dueDate ? true : undefined}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </label>

        <SelectField
          label={t('actionPlans.priority')}
          value={priority}
          onChange={setPriority}
          options={ACTION_PLAN_PRIORITIES.map((value) => ({
            value,
            label: priorityLabel(t, value),
          }))}
        />
      </div>

      {templates.length > 0 && (
        // Reference-only: selecting a template just sets templateId on the create
        // request (a one-field pass-through the backend validates, scopes to the
        // caller's company and counts a usage against). It does not copy the
        // template's KPIs/objectives into this form -- that auto-population is
        // explicitly out of scope for this slice.
        <SelectField
          label={t('actionPlans.startFromTemplate')}
          value={templateId}
          onChange={setTemplateId}
          options={[
            { value: NO_TEMPLATE, label: t('actionPlans.noTemplate') },
            ...templates.map((template) => ({ value: template.id, label: template.name })),
          ]}
        />
      )}

      <Separator />

      <div>
        <H3>{t('actionPlans.kpisShort')}</H3>
        <p className="mb-panel-gap text-sm text-fg-secondary">{t('actionPlans.kpisHint')}</p>
        {kpis.map((kpi, index) => (
          <div key={index} className="mb-panel-gap grid items-end gap-inline md:grid-cols-4">
            <TextField
              label={t('actionPlans.metric')}
              value={kpi.name}
              onChange={(value) => updateKpi(index, { name: value })}
              error={fieldErrors[`kpi-${index}`]}
            />
            <TextField
              type="number"
              label={t('actionPlans.targetValue')}
              value={kpi.targetValue}
              onChange={(value) => updateKpi(index, { targetValue: value })}
            />
            <TextField
              label={t('actionPlans.unit')}
              value={kpi.unit}
              onChange={(value) => updateKpi(index, { unit: value })}
              placeholder={t('actionPlans.unitPlaceholder')}
            />
            <div className="flex items-end gap-inline">
              <SelectField
                className="flex-1"
                label={t('actionPlans.measurementFrequency')}
                value={kpi.measurementFrequency}
                onChange={(value) => updateKpi(index, { measurementFrequency: value })}
                options={MEASUREMENT_FREQUENCIES.map((value) => ({
                  value,
                  label: frequencyLabel(t, value),
                }))}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setKpis((current) => current.filter((_, i) => i !== index))}
              >
                {t('common.delete')}
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => setKpis((c) => [...c, EMPTY_KPI])}>
          {t('actionPlans.addKPI')}
        </Button>
      </div>

      <div>
        <H3>{t('actionPlans.objectives')}</H3>
        <p className="mb-panel-gap text-sm text-fg-secondary">{t('actionPlans.objectivesHint')}</p>
        {objectives.map((objective, index) => (
          <div key={index} className="mb-panel-gap grid items-end gap-inline md:grid-cols-[1fr_1fr_auto]">
            <TextField
              label={t('actionPlans.description')}
              value={objective.description}
              onChange={(value) => updateObjective(index, { description: value })}
              error={fieldErrors[`objective-${index}`]}
            />
            <TextField
              label={t('actionPlans.successCriteria')}
              value={objective.successCriteria}
              onChange={(value) => updateObjective(index, { successCriteria: value })}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => setObjectives((current) => current.filter((_, i) => i !== index))}
            >
              {t('common.delete')}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setObjectives((c) => [...c, EMPTY_OBJECTIVE])}
        >
          {t('actionPlans.addObjective')}
        </Button>
      </div>

      <Separator />

      <div className="flex flex-wrap gap-inline">
        <Button type="submit" disabled={submitting}>
          {submitting ? t('common.creating') : t('actionPlans.createActionPlan')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  )
}
