import { useId, useState, type FormEvent } from 'react'
import { Alert, AlertDescription, Button, Input } from '../../../../components/ui'
import { useTranslation } from '../../../../i18n'
import { submitIntakeRows, type IntakeRow } from '../../api/intake'
import { intakeReasons } from '../../components/intake/intakeReasons'
import type { Department } from '../../api/departments'
import type { BulkImportRowResult } from '../../api/bulkImport'
import { CanvasSelect, Field } from '../super/parts'

/**
 * "Agregar una persona" — ONE new account, typed rather than imported.
 *
 * ## Why this is a form and not an endpoint
 *
 * There is no `POST /admin/users`: the only route that creates a person is the roster
 * importer. Until this form, adding a single new hire meant building a spreadsheet for one
 * row — which is what October did. So this posts one row through
 * `POST /admin/users/bulk-import/rows`, the same path the wizard commits with, rather than
 * adding a second creation path. That matters more than the line count it saves: the importer
 * is where several hard-won decisions live, and a hand-rolled insert would have none of them —
 * the account's language defaults to the COMPANY's rather than to `en` (or a Costa Rican
 * workforce is reminded in English), and a `per_survey` company's account is deliberately
 * given no username and no password hash, because its key is minted per survey and an account
 * password would be a wider key than the mode hands out.
 *
 * ## It previews before it commits, and it mails nothing
 *
 * The same two calls the wizard makes: `preview: true` to get the server's verdict on the row
 * (a duplicate address, an unknown department, a reserved domain), then `preview: false` to
 * write it. The preview is what turns "the server said 400" into a sentence naming the field.
 *
 * `withCredentials` is always **false**. Creating a person is not a reason to email them: who
 * gets mail is decided on Distribución, against a list the client named. A form that quietly
 * sent sign-in details would be the 28 Oct mis-send with a nicer button.
 */
export default function AddPersonForm({
  baseUrl,
  companyId,
  departments,
  onAdded,
}: {
  baseUrl: string
  companyId: string
  /** `null` when the department list failed to load: the field then offers "no department" only. */
  departments: readonly Department[] | null
  onAdded: () => void
}) {
  const { t } = useTranslation()
  const ids = { name: useId(), email: useId(), department: useId(), role: useId() }
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [role, setRole] = useState('employee')
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const copy = (key: string, vars?: Record<string, string | number>) => t(`users.next.add.${key}`, vars)
  const reasonsOf = (row: BulkImportRowResult) =>
    intakeReasons(row, t, t('users.intake.roleMissing')).join(' ') || copy('failed')
  const options = (departments ?? []).filter((unit) => unit.isActive)
  // The row carries the department by NAME, which is what the importer's column holds. An id
  // would not survive the same path, and `newDepartments` is left empty on purpose: creating a
  // department as a side effect of typing a person's name into a box is not something this
  // form should be able to do by accident.
  const departmentName = options.find((unit) => unit.id === departmentId)?.name ?? null

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setAdded(null)
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    if (!trimmedName || !trimmedEmail) {
      setError(copy('required'))
      return
    }

    const row: IntakeRow = {
      rowNumber: 1,
      name: trimmedName,
      email: trimmedEmail,
      role,
      department: departmentName,
    }

    setSaving(true)
    try {
      // The server's verdict, said in the reader's language: `issues` carries stable codes and
      // `errors` the English sentences beside them, so a refusal this screen knows is
      // translated (`intakeReasons`) and anything else keeps the English rather than vanishing.
      const preview = await submitIntakeRows(baseUrl, companyId, [row], true, [], false)
      const previewed = preview.rows?.[0]
      if (previewed && previewed.errors.length > 0) {
        setError(reasonsOf(previewed))
        return
      }

      const committed = await submitIntakeRows(baseUrl, companyId, [row], false, [], false)
      const written = committed.rows?.[0]
      if (committed.errorCount > 0 || (written && written.errors.length > 0)) {
        setError(written ? reasonsOf(written) : copy('failed'))
        return
      }

      setAdded(trimmedName)
      setName('')
      setEmail('')
      setDepartmentId('')
      setRole('employee')
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {added && (
        <Alert>
          <AlertDescription role="status">{copy('added', { name: added })}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 md:grid-cols-2">
        <Field fieldLabel={copy('name')} htmlFor={ids.name}>
          <Input id={ids.name} value={name} onChange={(event) => setName(event.target.value)} className="w-full" required />
        </Field>
        <Field fieldLabel={copy('email')} htmlFor={ids.email} helper={copy('emailHelper')}>
          <Input
            id={ids.email}
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full font-mono"
            required
          />
        </Field>
        <Field fieldLabel={copy('department')} htmlFor={ids.department} helper={copy('departmentHelper')}>
          <CanvasSelect
            id={ids.department}
            className="w-full"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">{copy('noDepartment')}</option>
            {options.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </CanvasSelect>
        </Field>
        <Field fieldLabel={copy('role')} htmlFor={ids.role} helper={copy('roleHelper')}>
          <CanvasSelect id={ids.role} className="w-full" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="employee">{t('users.employee')}</option>
            <option value="supervisor">{t('users.supervisor')}</option>
            <option value="leader">{t('users.leader')}</option>
          </CanvasSelect>
        </Field>
      </div>

      {/* Said on the form, not only in a release note: this creates the account and sends
          nothing. An administrator who expects the person to receive something otherwise waits
          for an email that was never going to arrive. */}
      <p className="m-0 text-sm text-fg-secondary">{copy('sendsNothing')}</p>

      <div>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? copy('adding') : copy('submit')}
        </Button>
      </div>
    </form>
  )
}
