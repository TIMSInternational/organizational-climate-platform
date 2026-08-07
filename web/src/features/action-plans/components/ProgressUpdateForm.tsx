import { useEffect, useState, type FormEvent } from 'react'
import type { Kpi, Objective, KpiUpdateInput, ObjectiveUpdateInput } from '../api/actionPlans'
import { useTranslation } from '../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  EmptyState,
  SectionLabel,
  TextField,
  TextareaField,
} from '../../../components/ui'

export interface ProgressUpdateFormValues {
  overallNotes: string
  kpiUpdates: KpiUpdateInput[]
  objectiveUpdates: ObjectiveUpdateInput[]
}

interface ProgressUpdateFormProps {
  kpis: readonly Kpi[]
  objectives: readonly Objective[]
  onSubmit: (values: ProgressUpdateFormValues) => Promise<void>
  disabled?: boolean
}

/** The numeric fields are held as text — see `ActionPlanForm`'s `KpiDraft` for why. */
function toTextMap<T>(rows: readonly T[], id: (row: T) => string, value: (row: T) => number) {
  return Object.fromEntries(rows.map((row) => [id(row), String(value(row))]))
}

function toStringMap<T>(rows: readonly T[], id: (row: T) => string, value: (row: T) => string) {
  return Object.fromEntries(rows.map((row) => [id(row), value(row)]))
}

/**
 * `POST /action-plans/{id}/progress`.
 *
 * ## Only changed rows are sent
 *
 * The form is pre-filled with every KPI's and objective's current server value, so
 * submitting it unmodified would send an update for each one. `RecordProgressAsync`
 * would accept all of them — it writes an `ActionPlanKpiUpdate` /
 * `ActionPlanObjectiveUpdate` row per entry regardless of whether the value moved —
 * and the audit trail would fill with rows recording that nothing changed. Diffing
 * against the props means an update row exists only where something actually moved.
 *
 * ## What is validated here, and what is left to the server
 *
 * `OverallNotes` is the one thing `RecordProgressAsync` requires (400 otherwise), and
 * it is checked here so the user is told before a round trip rather than after. The
 * completion percentage is checked because the server does **not**: it assigns
 * `objective.CompletionPercentage = value` for any int at all, so -20 or 300 would
 * persist and then render as a `<Progress>` bar of nonsense length.
 *
 * Ownership of a KPI/objective id is *not* pre-checked — that is
 * `RecordProgressAsync`'s cross-plan guard and its message is better than a guess.
 */
export default function ProgressUpdateForm({
  kpis,
  objectives,
  onSubmit,
  disabled,
}: ProgressUpdateFormProps) {
  const { t } = useTranslation()
  const [overallNotes, setOverallNotes] = useState('')
  const [kpiValues, setKpiValues] = useState<Record<string, string>>(() =>
    toTextMap(kpis, (k) => k.id, (k) => k.currentValue),
  )
  const [objectiveStatuses, setObjectiveStatuses] = useState<Record<string, string>>(() =>
    toStringMap(objectives, (o) => o.id, (o) => o.currentStatus),
  )
  const [objectivePercentages, setObjectivePercentages] = useState<Record<string, string>>(() =>
    toTextMap(objectives, (o) => o.id, (o) => o.completionPercentage),
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Resync local edit state whenever the parent supplies fresh kpis/objectives
  // (e.g. after the refetch that follows a successful submission), so a second
  // update in the same session starts from the latest server values rather than
  // stale pre-submission ones -- and so the "only changed rows" diff above is
  // taken against what the server now holds.
  useEffect(() => {
    setKpiValues(toTextMap(kpis, (k) => k.id, (k) => k.currentValue))
  }, [kpis])

  useEffect(() => {
    setObjectiveStatuses(toStringMap(objectives, (o) => o.id, (o) => o.currentStatus))
    setObjectivePercentages(toTextMap(objectives, (o) => o.id, (o) => o.completionPercentage))
  }, [objectives])

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {}
    if (!overallNotes.trim()) errors.overallNotes = t('validation.required')
    for (const kpi of kpis) {
      const raw = kpiValues[kpi.id] ?? ''
      if (raw.trim() === '' || !Number.isFinite(Number(raw))) {
        errors[`kpi-${kpi.id}`] = t('validation.invalidNumber')
      }
    }
    for (const objective of objectives) {
      const raw = objectivePercentages[objective.id] ?? ''
      const parsed = Number(raw)
      if (raw.trim() === '' || !Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
        errors[`objective-${objective.id}`] = t('actionPlans.percentageRange')
      }
    }
    return errors
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    const kpiUpdates: KpiUpdateInput[] = kpis
      .filter((kpi) => Number(kpiValues[kpi.id]) !== kpi.currentValue)
      .map((kpi) => ({ kpiId: kpi.id, newValue: Number(kpiValues[kpi.id]) }))

    const objectiveUpdates: ObjectiveUpdateInput[] = objectives
      .filter(
        (objective) =>
          objectiveStatuses[objective.id] !== objective.currentStatus ||
          Number(objectivePercentages[objective.id]) !== objective.completionPercentage,
      )
      .map((objective) => ({
        objectiveId: objective.id,
        statusUpdate: objectiveStatuses[objective.id],
        completionPercentage: Number(objectivePercentages[objective.id]),
      }))

    setSubmitting(true)
    try {
      await onSubmit({ overallNotes: overallNotes.trim(), kpiUpdates, objectiveUpdates })
      // Cleared only on success. A failed submission keeps everything the user
      // typed, including the notes, so retrying costs nothing.
      setOverallNotes('')
    } catch (err) {
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

      <TextareaField
        label={t('actionPlans.notes')}
        description={t('actionPlans.notesHint')}
        required
        rows={3}
        value={overallNotes}
        onChange={setOverallNotes}
        error={fieldErrors.overallNotes}
        disabled={disabled}
        placeholder={t('actionPlans.notesPlaceholder')}
      />

      {kpis.length > 0 && (
        <div className="flex flex-col gap-inline">
          <SectionLabel>{t('actionPlans.kpisShort')}</SectionLabel>
          {kpis.map((kpi) => (
            <TextField
              key={kpi.id}
              type="number"
              label={kpi.unit ? `${kpi.name} (${kpi.unit})` : kpi.name}
              // The target is the number the value is being moved toward, so it
              // belongs next to the input rather than only in the table above.
              description={t('actionPlans.targetIs', { target: kpi.targetValue })}
              value={kpiValues[kpi.id] ?? ''}
              onChange={(value) => setKpiValues((current) => ({ ...current, [kpi.id]: value }))}
              error={fieldErrors[`kpi-${kpi.id}`]}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {objectives.length > 0 && (
        <div className="flex flex-col gap-inline">
          <SectionLabel>{t('actionPlans.objectives')}</SectionLabel>
          {objectives.map((objective) => (
            <div key={objective.id} className="grid items-start gap-inline md:grid-cols-2">
              <TextField
                label={objective.description}
                description={t('actionPlans.statusUpdateHint')}
                value={objectiveStatuses[objective.id] ?? ''}
                onChange={(value) =>
                  setObjectiveStatuses((current) => ({ ...current, [objective.id]: value }))
                }
                disabled={disabled}
              />
              <TextField
                type="number"
                label={t('actionPlans.completionPercentage')}
                value={objectivePercentages[objective.id] ?? ''}
                onChange={(value) =>
                  setObjectivePercentages((current) => ({ ...current, [objective.id]: value }))
                }
                error={fieldErrors[`objective-${objective.id}`]}
                disabled={disabled}
              />
            </div>
          ))}
        </div>
      )}

      {kpis.length === 0 && objectives.length === 0 && (
        // Still submittable: a note with no measures attached is a legitimate
        // progress entry, and `RecordProgressAsync` requires only the note.
        <EmptyState
          title={t('actionPlans.noMeasures')}
          description={t('actionPlans.noMeasuresDescription')}
        />
      )}

      <div>
        <Button type="submit" disabled={submitting || disabled}>
          {submitting ? t('common.saving') : t('actionPlans.recordProgress')}
        </Button>
      </div>
    </form>
  )
}
