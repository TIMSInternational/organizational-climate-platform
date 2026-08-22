import { useState, type FormEvent } from 'react'
import { Alert, AlertDescription, Button, TextField, TextareaField } from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import type { RegistrarAvanceInput } from '../api/trackingApi'
import { fromPercent, toPercent } from '../semaforo'

/**
 * Recording progress on a plan — the one screen where the 0–1 / 0–100 mismatch
 * would bite.
 *
 * **The field is a percentage. The request is a fraction.** A user types `60`; the
 * body carries `0.6`. `fromPercent` is the only place that division happens, and
 * `PlanDeAccion.RegistrarAvance` throws
 * `ArgumentOutOfRangeException("porcentaje_avance debe estar entre 0 y 1")` — which
 * `RegistrarAvanceAsync` turns into a 400 — for anything else. Posting the typed
 * number straight through would 400 on every value above 1 and, worse, would
 * *succeed* for 0 and 1 while meaning 0% and 1%.
 *
 * The input starts at the plan's current percentage rather than blank, so the
 * common case ("we moved from 40 to 55") starts from the truth on record. That
 * initial value comes through `toPercent`, the inverse of the same conversion.
 *
 * ## The date is a calendar day, not now()
 *
 * `RegistrarAvanceRequest.Fecha` is a `DateOnly`, and the domain uses it for both
 * `FechaUltimaActualizacion` and the semáforo recalculation
 * (`diasSinActualizar = fechaActual.DayNumber - FechaUltimaActualizacion.DayNumber`).
 * The field defaults to today in the reader's own zone and is editable, because a
 * supervisor recording Friday's progress on Monday must be able to say Friday. It
 * is never round-tripped through `new Date(...).toISOString()`, which would move
 * the day for anyone east of UTC after their afternoon.
 */
export interface RegistrarAvanceFormProps {
  /** The plan's current `porcentajeAvance`, as stored: a fraction in `[0, 1]`. */
  currentAvance: number
  /** Today as `YYYY-MM-DD`. Injected so tests are not at the mercy of the clock. */
  today: string
  submitting?: boolean
  error?: string | null
  onSubmit: (input: RegistrarAvanceInput) => void
}

export default function RegistrarAvanceForm({
  currentAvance,
  today,
  submitting = false,
  error = null,
  onSubmit,
}: RegistrarAvanceFormProps) {
  const { t } = useTranslation()
  const [percent, setPercent] = useState(() => String(toPercent(currentAvance)))
  const [comentario, setComentario] = useState('')
  const [fecha, setFecha] = useState(today)
  const [invalid, setInvalid] = useState(false)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = Number(percent)
    // Rejected here rather than clamped silently: a typed `600` is a mistake, and
    // quietly sending 100% would record something the user did not mean. Blank is
    // caught by the same check, since `Number('')` is 0 but `percent.trim()` is not
    // a number the user chose.
    if (percent.trim() === '' || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onSubmit({
      // The whole point of this module: percentage in, fraction out.
      porcentajeAvance: fromPercent(parsed),
      comentario: comentario.trim() === '' ? null : comentario.trim(),
      fecha,
    })
  }

  return (
    // `noValidate` for the same reason `PlanDeAccionForm` carries it: a native
    // `type="number"` bubble would be in the browser's language, and the range this
    // field actually has to defend (0–100, which becomes 0–1) is stated in the
    // catalogue's words rather than the browser's.
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <TextField
        label={t('tracking.fields.avance')}
        description={t('tracking.fields.avanceHint')}
        type="number"
        value={percent}
        onChange={setPercent}
        disabled={submitting}
        error={invalid ? t('tracking.fields.avanceRange') : undefined}
        required
      />

      <TextField
        label={t('tracking.fields.fechaAvance')}
        description={t('tracking.fields.fechaAvanceHint')}
        type="date"
        value={fecha}
        onChange={setFecha}
        disabled={submitting}
        required
      />

      <TextareaField
        label={t('tracking.fields.comentario')}
        description={t('tracking.fields.comentarioHint')}
        value={comentario}
        onChange={setComentario}
        disabled={submitting}
        rows={2}
      />

      <div>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? t('common.saving') : t('tracking.actions.registrarAvance')}
        </Button>
      </div>
    </form>
  )
}
