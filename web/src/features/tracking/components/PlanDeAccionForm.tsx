import { useMemo, useState, type FormEvent } from 'react'
import {
  Alert,
  AlertDescription,
  Button,
  SelectField,
  TextField,
  TextareaField,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import type { CreatePlanAccionInput } from '../api/trackingApi'
import type { NodoPickerItem, PersonaPickerItem } from '../api/trackingPickers'
import { creatableNodos, type TrackingClaims } from '../trackingAccess'
import InvolucradosPicker from './InvolucradosPicker'

/**
 * The create form for a `PlanDeAccion`.
 *
 * Every field maps one-to-one onto `CreatePlanRequest`, and the two that the
 * service will silently reject are constrained here rather than validated on the
 * round trip:
 *
 * - **nodo** — `CreateAsync` forbids a non-admin from creating a plan on any node
 *   but their own (`currentUser.NodoExternalId != request.NodoExternalId` →
 *   `Forbid`). `creatableNodos` filters the options to match, so a leader is never
 *   offered a node that would 403.
 * - **fechaCompromiso** — a `DateOnly`, so the input is `type="date"` and the value
 *   is already `YYYY-MM-DD`. It is *not* run through `new Date()` on the way out:
 *   that would turn a calendar day into an instant and hand a timezone the chance
 *   to move it.
 *
 * ## No percentage field, deliberately
 *
 * `CreateAsync` calls `plan.RegistrarAvance(0m, ...)` itself, with the comment
 * "Plan creado", because `FechaUltimaActualizacion` has no public setter and that
 * is the domain's only way to initialise it. A plan therefore always starts at 0
 * and there is nothing here to ask for. Progress is recorded afterwards, on the
 * detail page.
 *
 * ## What happens when the pickers are empty
 *
 * `TrackingPickerEndpoints.CanAccessCompany` allows `super_admin` and a
 * `company_admin` on their own company and refuses everyone else — including the
 * `leader` who is allowed to create plans. When the lists come back empty (403, or
 * a company with no rows) the form does not pretend: the node and responsable
 * fields fall back to typed external ids, and the alert above says the directory
 * could not be loaded. Two empty dropdowns with no explanation would be worse.
 */
export interface PlanDeAccionFormValues {
  nodoExternalId: string
  descripcionQue: string
  metodologiaComo: string
  responsableEjecucionExternalId: string
  fechaCompromiso: string
  hallazgoExternalId: string
  involucrados: string[]
}

// Not exported. oxlint's `react(only-export-components)` fails a `.tsx` that
// exports a component and a plain value together, and the six-warning lint budget
// in this repository is a hard ceiling shared across every lane.
const EMPTY_PLAN_FORM: PlanDeAccionFormValues = {
  nodoExternalId: '',
  descripcionQue: '',
  metodologiaComo: '',
  responsableEjecucionExternalId: '',
  fechaCompromiso: '',
  hallazgoExternalId: '',
  involucrados: [],
}

export interface PlanDeAccionFormProps {
  claims: TrackingClaims | null
  nodos: readonly NodoPickerItem[]
  personas: readonly PersonaPickerItem[]
  /** True when the picker lookup failed or was refused — drives the explanation. */
  directoryUnavailable?: boolean
  submitting?: boolean
  error?: string | null
  onSubmit: (input: CreatePlanAccionInput) => void
  onCancel?: () => void
}

export default function PlanDeAccionForm({
  claims,
  nodos,
  personas,
  directoryUnavailable = false,
  submitting = false,
  error = null,
  onSubmit,
  onCancel,
}: PlanDeAccionFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<PlanDeAccionFormValues>(() => ({
    ...EMPTY_PLAN_FORM,
    // A leader creates on exactly one node, so pre-fill it rather than making them
    // pick the only option.
    nodoExternalId: claims && claims.role === 'leader' ? claims.nodoExternalId : '',
  }))
  const [touched, setTouched] = useState(false)

  const nodoOptions = useMemo(
    () => creatableNodos(nodos, claims).map((nodo) => ({ value: nodo.id, label: nodo.name })),
    [nodos, claims],
  )
  const personaOptions = useMemo(
    () =>
      personas.map((persona) => ({
        value: persona.id,
        label: `${persona.name} (${persona.email})`,
      })),
    [personas],
  )

  function patch(next: Partial<PlanDeAccionFormValues>) {
    setValues((current) => ({ ...current, ...next }))
  }

  const missing =
    values.nodoExternalId.trim() === '' ||
    values.descripcionQue.trim() === '' ||
    values.metodologiaComo.trim() === '' ||
    values.responsableEjecucionExternalId.trim() === '' ||
    values.fechaCompromiso === ''

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (missing) return
    onSubmit({
      nodoExternalId: values.nodoExternalId.trim(),
      descripcionQue: values.descripcionQue.trim(),
      metodologiaComo: values.metodologiaComo.trim(),
      responsableEjecucionExternalId: values.responsableEjecucionExternalId.trim(),
      // Sent through as the `YYYY-MM-DD` the date input produced. `DateOnly` parses
      // exactly this; constructing a `Date` here is what moves a compromiso a day.
      fechaCompromiso: values.fechaCompromiso,
      hallazgoExternalId:
        values.hallazgoExternalId.trim() === '' ? null : values.hallazgoExternalId.trim(),
      involucrados: values.involucrados,
    })
  }

  const requiredMissing = touched && missing

  return (
    // `noValidate`, as `ActionPlanForm` and `SurveyRespondForm` already do: the
    // browser's own required-field bubbles are in the BROWSER's language, not the
    // reader's, which on a Spanish-only module is exactly the wrong place to lose
    // the language. The messages below come from the catalogue instead.
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      {directoryUnavailable && (
        <Alert variant="warning">
          <AlertDescription>{t('tracking.form.directoryUnavailable')}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {nodoOptions.length > 0 ? (
        <SelectField
          label={t('tracking.fields.nodo')}
          description={t('tracking.fields.nodoHint')}
          placeholder={t('tracking.fields.nodoPlaceholder')}
          options={nodoOptions}
          value={values.nodoExternalId}
          onChange={(nodoExternalId) => patch({ nodoExternalId })}
          disabled={submitting || nodoOptions.length === 0}
          error={requiredMissing && values.nodoExternalId === '' ? t('validation.required') : undefined}
          required
        />
      ) : (
        <TextField
          label={t('tracking.fields.nodo')}
          description={t('tracking.fields.nodoIdHint')}
          value={values.nodoExternalId}
          onChange={(nodoExternalId) => patch({ nodoExternalId })}
          disabled={submitting}
          error={requiredMissing && values.nodoExternalId === '' ? t('validation.required') : undefined}
          required
        />
      )}

      <TextareaField
        label={t('tracking.fields.descripcionQue')}
        description={t('tracking.fields.descripcionQueHint')}
        value={values.descripcionQue}
        onChange={(descripcionQue) => patch({ descripcionQue })}
        disabled={submitting}
        rows={3}
        error={
          requiredMissing && values.descripcionQue.trim() === '' ? t('validation.required') : undefined
        }
        required
      />

      <TextareaField
        label={t('tracking.fields.metodologiaComo')}
        description={t('tracking.fields.metodologiaComoHint')}
        value={values.metodologiaComo}
        onChange={(metodologiaComo) => patch({ metodologiaComo })}
        disabled={submitting}
        rows={3}
        error={
          requiredMissing && values.metodologiaComo.trim() === ''
            ? t('validation.required')
            : undefined
        }
        required
      />

      {personaOptions.length > 0 ? (
        <SelectField
          label={t('tracking.fields.responsable')}
          description={t('tracking.fields.responsableHint')}
          placeholder={t('tracking.fields.responsablePlaceholder')}
          options={personaOptions}
          value={values.responsableEjecucionExternalId}
          onChange={(responsableEjecucionExternalId) => patch({ responsableEjecucionExternalId })}
          disabled={submitting}
          error={
            requiredMissing && values.responsableEjecucionExternalId === ''
              ? t('validation.required')
              : undefined
          }
          required
        />
      ) : (
        <TextField
          label={t('tracking.fields.responsable')}
          description={t('tracking.fields.responsableIdHint')}
          value={values.responsableEjecucionExternalId}
          onChange={(responsableEjecucionExternalId) => patch({ responsableEjecucionExternalId })}
          disabled={submitting}
          error={
            requiredMissing && values.responsableEjecucionExternalId === ''
              ? t('validation.required')
              : undefined
          }
          required
        />
      )}

      <TextField
        label={t('tracking.fields.fechaCompromiso')}
        description={t('tracking.fields.fechaCompromisoHint')}
        type="date"
        value={values.fechaCompromiso}
        onChange={(fechaCompromiso) => patch({ fechaCompromiso })}
        disabled={submitting}
        error={requiredMissing && values.fechaCompromiso === '' ? t('validation.required') : undefined}
        required
      />

      <TextField
        label={t('tracking.fields.hallazgo')}
        description={t('tracking.fields.hallazgoHint')}
        value={values.hallazgoExternalId}
        onChange={(hallazgoExternalId) => patch({ hallazgoExternalId })}
        disabled={submitting}
      />

      <InvolucradosPicker
        label={t('tracking.fields.involucrados')}
        description={t('tracking.fields.involucradosHint')}
        personas={personas}
        value={values.involucrados}
        onChange={(involucrados) => patch({ involucrados })}
        disabled={submitting}
      />

      <div className="flex flex-wrap gap-inline">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? t('common.saving') : t('tracking.actions.createPlan')}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  )
}
