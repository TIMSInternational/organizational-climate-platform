import { ArrowLeft } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { Button, Input, Table, type ChipTone } from '../../../../components/ui'
import { CanvasChip, CanvasSelect } from '../../next/super/parts'
import type { IntakeDemographicTarget, IntakeRow } from '../../api/intake'
import type { BulkImportIssue, BulkImportResponse, BulkImportRowResult } from '../../api/bulkImport'
import { ROLE_TARGETS } from './intakeModel'

/**
 * A duplicate is amber, not red: the row is not malformed, the person is simply already here or
 * already invited. Colouring it the same as a broken row would send the admin hunting for a typo
 * that is not there.
 */
const STATUS_TONE: Record<string, ChipTone> = {
  valid: 'good',
  invited: 'good',
  duplicate: 'warning',
  error: 'critical',
}

/**
 * The reasons the server names by code, each with a sentence in both catalogues
 * (`users.intake.reason.*`). A code outside this set is one this screen was not written for; it
 * falls back to the server's English rather than to nothing, because an unexplained red row is
 * worse than an untranslated one.
 */
const REASON_CODES: ReadonlySet<string> = new Set([
  'name_required',
  'invalid_email',
  'invalid_role',
  'department_not_found',
  'department_inactive',
  'invalid_demographic',
  'already_user',
  'already_invited',
  'repeated_in_file',
])

/**
 * Step 3: every row, editable, with the server's verdict against each one.
 *
 * ## Why the review step is not optional
 *
 * A spreadsheet filled in by somebody else is a proposal, not an instruction — and one mapped by
 * a model doubly so. The verdict shown against each row comes from the server's own preview, the
 * same code path the approval runs (`BulkImportEndpoints.ProcessRowsAsync`), so the screen the
 * admin approves is the thing that happens. Approval needs a CURRENT clean verdict: editing a
 * cell clears it, so nobody can validate, then edit, then approve something never checked.
 */
export function ReviewStep({
  rows,
  verdict,
  busy,
  departments,
  newDepartments,
  demographicTargets,
  onPatch,
  onRemove,
  onValidate,
  onApprove,
  onBack,
}: {
  rows: IntakeRow[]
  verdict: BulkImportResponse | null
  busy: boolean
  /** The company's active departments. */
  departments: string[]
  /** Departments the admin approved creating in the mapping step. */
  newDepartments: string[]
  demographicTargets: IntakeDemographicTarget[]
  onPatch: (rowNumber: number, patch: Partial<IntakeRow>) => void
  onRemove: (rowNumber: number) => void
  onValidate: () => void
  onApprove: () => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const verdictFor = (rowNumber: number) => verdict?.rows.find((r) => r.rowNumber === rowNumber)
  const blocking = verdict ? verdict.errorCount > 0 : true
  const hasDemographics = rows.some((row) => row.demographics && Object.values(row.demographics).some((v) => v))
  const fieldLabel = (field: string) => demographicTargets.find((d) => d.field === field)?.label ?? field
  // The stored value is a key ("tiempo_completo"); the admin reads its label ("Tiempo completo").
  const optionLabel = (field: string, value: string) =>
    demographicTargets.find((d) => d.field === field)?.optionLabels?.[value] ?? value

  const reasonText = (row: BulkImportRowResult, issue: BulkImportIssue, index: number) =>
    REASON_CODES.has(issue.code)
      ? t(`users.intake.reason.${issue.code}`, { value: issue.value || t('users.intake.roleMissing') })
      : (row.errors[index] ?? issue.code)

  const reasonsFor = (row: BulkImportRowResult) =>
    row.issues && row.issues.length > 0 ? row.issues.map((issue, index) => reasonText(row, issue, index)) : row.errors

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="m-0">{t('users.intake.reviewBody', { count: rows.length })}</p>
      <Table>
        <thead>
          <tr>
            <th>{t('users.row')}</th>
            <th>{t('users.name')}</th>
            <th>{t('users.email')}</th>
            <th>{t('users.role')}</th>
            <th>{t('users.department')}</th>
            <th>{t('common.status')}</th>
            {/* `relative`: an `sr-only` span is absolutely positioned, and with no positioned
                ancestor inside the table's scroll box it escaped it and widened the whole
                page at phone width. */}
            <th className="relative">
              <span className="sr-only">{t('users.intake.removeRow')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowVerdict = verdictFor(row.rowNumber)
            const demographics = Object.entries(row.demographics ?? {}).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
            )
            return (
              <tr key={row.rowNumber}>
                <td>{row.rowNumber}</td>
                <td>
                  <Input
                    className="min-w-36"
                    aria-label={t('users.name')}
                    value={row.name}
                    onChange={(e) => onPatch(row.rowNumber, { name: e.target.value })}
                  />
                </td>
                <td>
                  <Input
                    className="min-w-56"
                    aria-label={t('users.email')}
                    value={row.email}
                    onChange={(e) => onPatch(row.rowNumber, { email: e.target.value })}
                  />
                </td>
                <td>
                  <CanvasSelect
                    className="min-w-32"
                    aria-label={t('users.role')}
                    value={row.role}
                    onChange={(e) => onPatch(row.rowNumber, { role: e.target.value })}
                  >
                    {/* The role the file named is kept as an option even when this import does
                        not accept it, so the cell shows what was written rather than silently
                        becoming somebody else's role. */}
                    {!ROLE_TARGETS.includes(row.role as (typeof ROLE_TARGETS)[number]) && (
                      <option value={row.role}>{row.role || t('users.intake.roleMissing')}</option>
                    )}
                    {ROLE_TARGETS.map((role) => (
                      <option key={role} value={role}>
                        {t(`users.intake.role.${role}`)}
                      </option>
                    ))}
                  </CanvasSelect>
                </td>
                <td>
                  <CanvasSelect
                    className="min-w-32"
                    aria-label={t('users.department')}
                    value={row.department ?? ''}
                    onChange={(e) =>
                      onPatch(row.rowNumber, { department: e.target.value === '' ? null : e.target.value })
                    }
                  >
                    <option value="">{t('users.intake.noDepartment')}</option>
                    {/* Kept, like an unknown role: the cell shows what the file said, and the
                        verdict names it, until the admin picks a real one. */}
                    {row.department !== null &&
                      !departments.includes(row.department) &&
                      !newDepartments.includes(row.department) && (
                        <option value={row.department}>{row.department}</option>
                      )}
                    {departments.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    {newDepartments.map((name) => (
                      <option key={`new:${name}`} value={name}>
                        {t('users.intake.review.newDepartmentOption', { name })}
                      </option>
                    ))}
                  </CanvasSelect>
                  {/* Under the department rather than in a column of their own: another column
                      pushed the verdict off the panel at 1440, and the verdict is what this step
                      is for. Read-only; the mapping step is where they are changed. */}
                  {hasDemographics && demographics.length > 0 && (
                    <span className="mt-1.5 flex max-w-56 flex-wrap gap-1">
                      {demographics.map(([field, value]) => (
                        <CanvasChip
                          key={field}
                          tone="neutral"
                          label={t('users.intake.review.demographicChip', { field: fieldLabel(field), value: optionLabel(field, value) })}
                        />
                      ))}
                    </span>
                  )}
                </td>
                {/* The reason sits under its chip rather than in a column of its own: eight
                    columns with readable inputs overran the panel at 1440 and cut the reasons
                    off, which are the one thing this step exists to show. */}
                <td className="min-w-52 align-top">
                  {rowVerdict && (
                    <div className="flex flex-col items-start gap-1">
                      <CanvasChip
                        tone={STATUS_TONE[rowVerdict.status] ?? 'neutral'}
                        label={t(`users.intake.rowStatus.${rowVerdict.status}`)}
                      />
                      {reasonsFor(rowVerdict).length > 0 && (
                        <span className="text-sm leading-snug text-fg-secondary">{reasonsFor(rowVerdict).join(' ')}</span>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <Button type="button" variant="ghost" onClick={() => onRemove(row.rowNumber)}>
                    {t('users.intake.removeRow')}
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      {verdict && (
        <p className="m-0">
          {t('users.bulkImportSummary', {
            succeeded: verdict.successCount,
            errors: verdict.errorCount,
            total: verdict.rows.length,
          })}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('common.back')}
        </Button>
        <Button type="button" variant="secondary" onClick={onValidate} disabled={busy || rows.length === 0}>
          {t('users.intake.validate')}
        </Button>
        <Button type="button" variant="primary" onClick={onApprove} disabled={busy || blocking}>
          {t('users.intake.approve')}
        </Button>
      </div>
      {blocking && (
        <p className="m-0 text-sm text-fg-tertiary">
          {verdict ? t('users.intake.fixBeforeApproving') : t('users.intake.validateFirst')}
        </p>
      )}
    </div>
  )
}
