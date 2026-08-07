import { useState, type FormEvent } from 'react'
import type { Department } from '../api/departments'
import { useTranslation } from '../../../i18n'
import {
  Alert,
  AlertDescription,
  Button,
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  Spinner,
  TextField,
  TextareaField,
} from '../../../components/ui'

export interface DepartmentFormValues {
  name: string
  description: string
  parentDepartmentId: string
  isActive: boolean
}

interface DepartmentFormProps {
  departments: Department[]
  initialValues?: Partial<DepartmentFormValues>
  excludeIdFromParentOptions?: string
  /**
   * Renders the parent selector read-only with an explanation.
   *
   * `PUT /admin/departments/{id}` takes `UpdateDepartmentRequest(string? Name,
   * string? Description, bool? IsActive)` — **it has no `ParentDepartmentId` field
   * at all**, so a reparent chosen here is silently dropped by the server and the
   * row comes back unchanged. An editable control that does nothing is worse than
   * a disabled one that says why, so edit callers pass this.
   */
  parentLocked?: boolean
  submitLabel: string
  onSubmit: (values: DepartmentFormValues) => Promise<void>
}

const EMPTY_VALUES: DepartmentFormValues = {
  name: '',
  description: '',
  parentDepartmentId: '',
  isActive: true,
}

/** Mirrors `DepartmentEndpoints` server-side validation, so a 400 is not the first feedback. */
const NAME_MAX_LENGTH = 100
const DESCRIPTION_MAX_LENGTH = 500

export default function DepartmentForm({
  departments,
  initialValues,
  excludeIdFromParentOptions,
  parentLocked = false,
  submitLabel,
  onSubmit,
}: DepartmentFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<DepartmentFormValues>({ ...EMPTY_VALUES, ...initialValues })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const parentOptions = departments.filter((d) => d.id !== excludeIdFromParentOptions)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit(values)
    } catch (err) {
      // The server's own message, not a generic one: `DepartmentEndpoints`
      // answers 400 with the specific rule that was broken ("Department with
      // this name already exists at this level"), and `authFetch` already
      // unwraps `{ message }` off the body.
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form className="grid gap-panel-gap" onSubmit={handleSubmit}>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-panel-gap md:grid-cols-2">
        <TextField
          label={t('departments.name')}
          value={values.name}
          required
          maxLength={NAME_MAX_LENGTH}
          placeholder={t('departments.enterDepartmentName')}
          disabled={submitting}
          onChange={(name) => setValues({ ...values, name })}
        />

        <FormItem>
          <FormLabel>{t('departments.parentDepartment')}</FormLabel>
          <FormControl>
            <select
              value={values.parentDepartmentId}
              disabled={parentLocked || submitting}
              onChange={(e) => setValues({ ...values, parentDepartmentId: e.target.value })}
            >
              <option value="">{t('common.noneTopLevel')}</option>
              {parentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FormControl>
          {parentLocked && <FormDescription>{t('departments.parentLockedOnEdit')}</FormDescription>}
        </FormItem>
      </div>

      <TextareaField
        label={t('departments.description')}
        value={values.description}
        rows={3}
        maxLength={DESCRIPTION_MAX_LENGTH}
        placeholder={t('departments.enterDepartmentDescription')}
        disabled={submitting}
        onChange={(description) => setValues({ ...values, description })}
      />

      {/* A native checkbox rather than `CheckboxField`: this row is inside a
          `<form>` that submits on Enter, and Radix's checkbox is a button —
          keeping it native means the whole form stays keyboard-submittable and
          the control is reachable by label text in tests. */}
      <FormItem>
        <div className="flex items-center gap-inline">
          <FormControl>
            <input
              type="checkbox"
              checked={values.isActive}
              disabled={submitting}
              onChange={(e) => setValues({ ...values, isActive: e.target.checked })}
            />
          </FormControl>
          <FormLabel>{t('common.active')}</FormLabel>
        </div>
        <FormDescription>{t('departments.inactiveHidesFromAssignment')}</FormDescription>
      </FormItem>

      <div className="flex items-center gap-inline">
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting && <Spinner size="sm" />}
          {submitting ? t('common.saving') : submitLabel}
        </Button>
      </div>
    </form>
  )
}
