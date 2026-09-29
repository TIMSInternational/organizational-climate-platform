import { useEffect, useId, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, Button, Input, Table, type ChipTone } from '../../../components/ui'
import { CanvasChip, CanvasSelect } from '../next/super/parts'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import {
  getIntakeTemplate,
  IntakeRequestError,
  parseIntakeWorkbook,
  submitIntakeRows,
  type IntakeParseProblem,
  type IntakeRow,
} from '../api/intake'
import type { BulkImportIssue, BulkImportResponse, BulkImportRowResult } from '../api/bulkImport'
import { listDepartments } from '../api/departments'

/**
 * The Excel intake, as three steps: take the template, review what it read, approve it.
 *
 * ## Why the review step is not optional
 *
 * A spreadsheet filled in by somebody else is a proposal, not an instruction. Every row here is
 * editable before anything is created, and the verdict shown against each one comes from the
 * server's own preview — the same code path the approval runs — so the screen the admin approves
 * is the thing that happens. `BulkImportEndpoints.ProcessRowsAsync` is the single body both
 * share; see its remarks.
 *
 * ## Where the AI goes, when it goes
 *
 * Step 1 is the only step that knows the upload is a spreadsheet. A document-extraction step
 * (Bedrock; #92/#111/#119, blocked on provider approval and a cost ceiling) becomes a different
 * producer of the same `IntakeRow[]` and changes nothing below. Nothing here is AI today, which
 * is deliberate: a deterministic parser cannot fail live in front of a client.
 */

const ROLE_OPTIONS = ['employee', 'leader', 'supervisor'] as const

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

type Step = 'template' | 'review' | 'done'

/**
 * The reasons the server names by code, each with a sentence in both catalogues
 * (`users.intake.reason.*`, `users.intake.problem.*`). A code outside these sets is one this
 * screen was not written for; it falls back to the server's English rather than to nothing,
 * because an unexplained red row is worse than an untranslated one.
 */
const REASON_CODES: ReadonlySet<string> = new Set([
  'name_required',
  'invalid_email',
  'invalid_role',
  'department_not_found',
  'already_user',
  'already_invited',
  'repeated_in_file',
])
const PROBLEM_CODES: ReadonlySet<string> = new Set(['no_people_sheet', 'no_header', 'missing_column', 'no_data_rows'])

interface IntakeWizardProps {
  baseUrl: string
  companyId: string
  onImported: () => void
}

export default function IntakeWizard({ baseUrl, companyId, onImported }: IntakeWizardProps) {
  const { t } = useTranslation()
  const fileInputId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('template')
  const [rows, setRows] = useState<IntakeRow[]>([])
  const [problems, setProblems] = useState<IntakeParseProblem[]>([])
  const [verdict, setVerdict] = useState<BulkImportResponse | null>(null)
  const [result, setResult] = useState<BulkImportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const departmentNames = useActiveDepartmentNames(baseUrl, companyId)

  /** Every verdict is about the rows as they were when it was asked for. */
  function invalidateVerdict() {
    setVerdict(null)
  }

  async function run(work: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await work()
    } catch (err) {
      // Never the server's English at a Spanish reader: a code this screen knows is said in the
      // reader's language, and anything else is the generic sentence.
      setError(
        err instanceof IntakeRequestError && err.code === 'not_a_workbook'
          ? t('users.intake.notAWorkbook')
          : t('errors.generic'),
      )
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = () =>
    run(async () => {
      const blob = await getIntakeTemplate(baseUrl, companyId)
      downloadBlobFile(t('users.intake.templateFileName'), blob)
    })

  const handleFile = (file: File | null) => {
    if (!file) return
    void run(async () => {
      const parsed = await parseIntakeWorkbook(baseUrl, companyId, file)
      setRows(parsed.rows)
      setProblems(parsed.problems)
      setVerdict(null)
      setStep('review')
    })
  }

  const handleValidate = () =>
    run(async () => {
      setVerdict(await submitIntakeRows(baseUrl, companyId, rows, true))
    })

  const handleApprove = () =>
    run(async () => {
      const committed = await submitIntakeRows(baseUrl, companyId, rows, false)
      setResult(committed)
      setStep('done')
      onImported()
    })

  function patchRow(rowNumber: number, patch: Partial<IntakeRow>) {
    setRows((current) => current.map((row) => (row.rowNumber === rowNumber ? { ...row, ...patch } : row)))
    invalidateVerdict()
  }

  function removeRow(rowNumber: number) {
    setRows((current) => current.filter((row) => row.rowNumber !== rowNumber))
    invalidateVerdict()
  }

  const verdictFor = (rowNumber: number) => verdict?.rows.find((r) => r.rowNumber === rowNumber)

  const reasonText = (row: BulkImportRowResult, issue: BulkImportIssue, index: number) =>
    REASON_CODES.has(issue.code)
      ? t(`users.intake.reason.${issue.code}`, { value: issue.value || t('users.intake.roleMissing') })
      : (row.errors[index] ?? issue.code)

  const reasonsFor = (row: BulkImportRowResult) =>
    row.issues && row.issues.length > 0 ? row.issues.map((issue, index) => reasonText(row, issue, index)) : row.errors
  const blocking = verdict ? verdict.errorCount > 0 : true

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ol className="m-0 flex list-none gap-2 p-0 text-sm text-fg-tertiary">
        {(['template', 'review', 'done'] as const).map((name, index) => (
          <li key={name} className={step === name ? 'font-semibold text-fg-primary' : undefined}>
            {t(`users.intake.step.${name}`, { n: index + 1 })}
          </li>
        ))}
      </ol>

      {step === 'template' && (
        <div className="flex flex-col gap-3">
          <p className="m-0">{t('users.intake.templateBody')}</p>
          <div>
            <Button type="button" variant="secondary" onClick={handleDownload} disabled={busy}>
              <Download aria-hidden="true" className="size-4" />
              {t('users.intake.downloadTemplate')}
            </Button>
          </div>
          <label htmlFor={fileInputId} className="m-0 text-sm font-medium">
            {t('users.intake.uploadLabel')}
          </label>
          {/* The native control stays for assistive tech and the file dialog, but is not drawn:
              its "Choose File / No file chosen" is written by the browser in the browser's own
              language, which put English on a Spanish screen. */}
          <input
            ref={fileInput}
            id={fileInputId}
            type="file"
            accept=".xlsx"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null
              setFileName(file?.name ?? null)
              handleFile(file)
              // Cleared so choosing the same file again, after a fix in Excel, still uploads it.
              event.target.value = ''
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Upload aria-hidden="true" className="size-4" />
              {t('users.intake.chooseFile')}
            </Button>
            <span className="text-sm text-fg-tertiary">{fileName ?? t('users.intake.noFileChosen')}</span>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="flex flex-col gap-3">
          {problems.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="m-0 list-disc pl-5">
                  {problems.map((problem) => (
                    <li key={`${problem.sheet}:${problem.code}:${problem.value ?? ''}`}>
                      {PROBLEM_CODES.has(problem.code)
                        ? t(`users.intake.problem.${problem.code}`, { value: problem.value ?? '' })
                        : problem.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {rows.length === 0 ? (
            <>
              <p className="m-0">{t('users.intake.emptyBody')}</p>
              <div>
                <Button type="button" variant="secondary" onClick={() => setStep('template')} disabled={busy}>
                  {t('common.back')}
                </Button>
              </div>
            </>
          ) : (
            <>
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
                    return (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>
                          <Input
                            className="min-w-36"
                            aria-label={t('users.name')}
                            value={row.name}
                            onChange={(e) => patchRow(row.rowNumber, { name: e.target.value })}
                          />
                        </td>
                        <td>
                          <Input
                            className="min-w-56"
                            aria-label={t('users.email')}
                            value={row.email}
                            onChange={(e) => patchRow(row.rowNumber, { email: e.target.value })}
                          />
                        </td>
                        <td>
                          <CanvasSelect
                            className="min-w-32"
                            aria-label={t('users.role')}
                            value={row.role}
                            onChange={(e) => patchRow(row.rowNumber, { role: e.target.value })}
                          >
                            {/* The role the file named is kept as an option even when this
                                import does not accept it, so the cell shows what was written
                                rather than silently becoming somebody else's role. */}
                            {!ROLE_OPTIONS.includes(row.role as (typeof ROLE_OPTIONS)[number]) && (
                              <option value={row.role}>{row.role || t('users.intake.roleMissing')}</option>
                            )}
                            {ROLE_OPTIONS.map((role) => (
                              <option key={role} value={role}>
                                {t(`users.intake.role.${role}`)}
                              </option>
                            ))}
                          </CanvasSelect>
                        </td>
                        <td>
                          {departmentNames ? (
                            <CanvasSelect
                              className="min-w-32"
                              aria-label={t('users.department')}
                              value={row.department ?? ''}
                              onChange={(e) =>
                                patchRow(row.rowNumber, { department: e.target.value === '' ? null : e.target.value })
                              }
                            >
                              <option value="">{t('users.intake.noDepartment')}</option>
                              {/* Kept, like an unknown role: the cell shows what the file said, and
                                  the verdict names it, until the admin picks a real one. */}
                              {row.department !== null && !departmentNames.includes(row.department) && (
                                <option value={row.department}>{row.department}</option>
                              )}
                              {departmentNames.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </CanvasSelect>
                          ) : (
                            <Input
                              className="min-w-32"
                              aria-label={t('users.department')}
                              value={row.department ?? ''}
                              onChange={(e) =>
                                patchRow(row.rowNumber, { department: e.target.value === '' ? null : e.target.value })
                              }
                            />
                          )}
                        </td>
                        {/* The reason sits under its chip rather than in a column of its own: eight
                            columns with readable inputs overran the panel at 1440 and cut the
                            reasons off, which are the one thing this step exists to show. */}
                        <td className="min-w-52 align-top">
                          {rowVerdict && (
                            <div className="flex flex-col items-start gap-1">
                              <CanvasChip
                                tone={STATUS_TONE[rowVerdict.status] ?? 'neutral'}
                                label={t(`users.intake.rowStatus.${rowVerdict.status}`)}
                              />
                              {reasonsFor(rowVerdict).length > 0 && (
                                <span className="text-sm leading-snug text-fg-secondary">
                                  {reasonsFor(rowVerdict).join(' ')}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => removeRow(row.rowNumber)}
                          >
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
                <Button type="button" variant="secondary" onClick={() => setStep('template')} disabled={busy}>
                  {t('common.back')}
                </Button>
                <Button type="button" variant="secondary" onClick={handleValidate} disabled={busy}>
                  {t('users.intake.validate')}
                </Button>
                {/* Approval is gated on a CURRENT clean verdict: editing a cell clears it, so
                    nobody can validate, then edit, then approve something never checked. */}
                <Button type="button" onClick={handleApprove} disabled={busy || blocking}>
                  {t('users.intake.approve')}
                </Button>
              </div>
              {blocking && (
                <p className="m-0 text-sm text-fg-tertiary">
                  {verdict ? t('users.intake.fixBeforeApproving') : t('users.intake.validateFirst')}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {step === 'done' && result && (
        <div className="flex flex-col gap-3">
          <p className="m-0">
            {t('users.bulkImportSummary', {
              succeeded: result.successCount,
              errors: result.errorCount,
              total: result.rows.length,
            })}
          </p>
          <p className="m-0">{t('users.intake.doneBody')}</p>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRows([])
                setProblems([])
                setVerdict(null)
                setResult(null)
                setStep('template')
              }}
            >
              {t('users.intake.startOver')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The company's active departments, for the review table's Departamento select — the same list
 * the template's dropdown carries (`TemplateAsync` reads active only), so a row can be corrected
 * to exactly the values an import accepts.
 *
 * `null` until it loads, and `null` if it fails: the cell then stays a text box, which the
 * server's verdict still checks. A department list that did not arrive must not leave the admin
 * with a select that offers nothing.
 */
function useActiveDepartmentNames(baseUrl: string, companyId: string): string[] | null {
  const [names, setNames] = useState<string[] | null>(null)
  useEffect(() => {
    let cancelled = false
    listDepartments(baseUrl, companyId)
      .then((departments) => {
        if (cancelled) return
        setNames(
          departments
            .filter((department) => department.isActive)
            .map((department) => department.name)
            .sort((a, b) => a.localeCompare(b)),
        )
      })
      .catch(() => {
        if (!cancelled) setNames(null)
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId])
  return names
}
