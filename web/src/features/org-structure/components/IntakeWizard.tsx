import { useEffect, useMemo, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, Button } from '../../../components/ui'
import { cn } from '../../../lib/cn'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import {
  getIntakeTemplate,
  IntakeRequestError,
  submitIntakeRows,
  understandIntakeFile,
  type IntakeAiFacts,
  type IntakeMapping,
  type IntakeRow,
  type IntakeUnderstanding,
} from '../api/intake'
import type { BulkImportResponse } from '../api/bulkImport'
import { UploadStep } from './intake/UploadStep'
import { UnderstandingProgress } from './intake/UnderstandingProgress'
import { UnderstandStep } from './intake/UnderstandStep'
import { ReviewStep } from './intake/ReviewStep'
import { REQUEST_ERROR_CODES, applyDomainFixes, createdDepartments } from './intake/intakeModel'

/**
 * The people intake: upload any spreadsheet → see how it was understood → review → done.
 *
 * ## Who reads the file
 *
 * The server (`POST /admin/users/bulk-import/understand`). It recognises our own template and
 * reads it by its fixed headers; anything else — a client's HR export in whatever layout — is
 * profiled, and Claude is shown the STRUCTURE (headers, category values, masked samples; never a
 * full name or email) and proposes a mapping. If the model cannot run, the server maps by header
 * words and says so. Whichever wrote it, the mapping comes back editable, and a corrected mapping
 * is re-applied by the server with no model call.
 *
 * ## Why nothing here can create anyone by accident
 *
 * Reading and mapping create nothing. The rows then go through the same review table as before,
 * and approval needs a CURRENT clean verdict from `/rows` in preview mode — the same server body
 * the approval runs — so the model's proposal is never what gets approved; the reviewed rows are.
 */

type Step = 'upload' | 'reading' | 'understand' | 'review' | 'done'

/** The four steps the header names; "reading" is step 2 in progress. */
const HEADER_STEPS = [
  { key: 'upload', steps: ['upload'] },
  { key: 'understand', steps: ['reading', 'understand'] },
  { key: 'review', steps: ['review'] },
  { key: 'done', steps: ['done'] },
] as const

interface Progress {
  mode: 'initial' | 'manual'
  startedAt: number
  outcome: IntakeUnderstanding | null
}

interface IntakeWizardProps {
  baseUrl: string
  companyId: string
  onImported: () => void
  /**
   * How long the finished checklist stays on screen before the result replaces it, so the last
   * ticks are seen rather than skipped. Tests pass 0.
   */
  revealDelayMs?: number
}

export default function IntakeWizard({ baseUrl, companyId, onImported, revealDelayMs = 700 }: IntakeWizardProps) {
  const { t, locale } = useTranslation()
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [understanding, setUnderstanding] = useState<IntakeUnderstanding | null>(null)
  const [draft, setDraft] = useState<IntakeMapping | null>(null)
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set())
  const [dirty, setDirty] = useState(false)
  const [fixes, setFixes] = useState<Readonly<Record<string, string>>>({})
  const [aiOrigin, setAiOrigin] = useState<IntakeAiFacts | null>(null)
  const [rows, setRows] = useState<IntakeRow[]>([])
  const [approvedNew, setApprovedNew] = useState<string[]>([])
  const [reviewSource, setReviewSource] = useState<IntakeUnderstanding | null>(null)
  const [verdict, setVerdict] = useState<BulkImportResponse | null>(null)
  const [result, setResult] = useState<BulkImportResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const fixedRows = useMemo(
    () => (understanding ? applyDomainFixes(understanding.rows, fixes) : []),
    [understanding, fixes],
  )

  // The finished checklist is held for a beat, then the answer replaces it.
  useEffect(() => {
    if (step !== 'reading' || !progress?.outcome) return
    const outcome = progress.outcome
    const timer = window.setTimeout(() => {
      setUnderstanding(outcome)
      setDraft(outcome.mapping)
      setDirty(false)
      setStep('understand')
      setProgress(null)
    }, revealDelayMs)
    return () => window.clearTimeout(timer)
  }, [step, progress, revealDelayMs])

  function messageFor(err: unknown) {
    // Never the server's English at a Spanish reader: a code this screen knows is said in the
    // reader's language, and anything else is the generic sentence.
    if (err instanceof IntakeRequestError && err.code !== null && REQUEST_ERROR_CODES.has(err.code)) {
      return err.code === 'not_a_workbook' ? t('users.intake.notAWorkbook') : t(`users.intake.error.${err.code}`)
    }
    return t('errors.generic')
  }

  async function run(work: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await work()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Sends the file (and, when correcting, the mapping) and shows the checklist while it runs. A
   * refusal returns to `back` — the upload, or the mapping being corrected — with the reason.
   */
  async function understand(target: File, mapping: IntakeMapping | undefined, back: Step) {
    const mode = mapping ? 'manual' : 'initial'
    setError(null)
    setBusy(true)
    setProgress({ mode, startedAt: performance.now(), outcome: null })
    setStep('reading')
    try {
      const answer = await understandIntakeFile(baseUrl, companyId, target, locale === 'en' ? 'en' : 'es', mapping)
      if (mode === 'initial') {
        setAiOrigin(answer.source === 'ai' ? answer.ai : null)
        setFixes({})
        setEdited(new Set())
        setReviewSource(null)
      } else if (answer.source === 'ai') {
        setAiOrigin(answer.ai)
      }
      setProgress((current) => (current ? { ...current, outcome: answer } : current))
    } catch (err) {
      setError(messageFor(err))
      setProgress(null)
      setStep(back)
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = () =>
    run(async () => {
      const blob = await getIntakeTemplate(baseUrl, companyId)
      downloadBlobFile(t('users.intake.templateFileName'), blob)
    })

  const handleFile = (chosen: File) => {
    setFile(chosen)
    void understand(chosen, undefined, 'upload')
  }

  const handleApply = () => {
    if (file && draft) void understand(file, draft, 'understand')
  }

  function handleMappingChange(next: IntakeMapping, key: string) {
    setDraft(next)
    setEdited((current) => new Set(current).add(key))
    setDirty(true)
  }

  function handleFix(from: string, to: string) {
    setFixes((current) => ({ ...current, [from]: to }))
    // Rows already carried to the review table are corrected too, and their verdict withdrawn.
    setRows((current) => applyDomainFixes(current, { [from]: to }))
    setVerdict(null)
  }

  function handleContinue() {
    if (!understanding) return
    // Coming back to the mapping and continuing again without changing it keeps the review
    // table's own edits; a re-applied mapping is a new set of rows.
    if (reviewSource !== understanding) {
      setRows(fixedRows)
      setReviewSource(understanding)
      setVerdict(null)
    }
    setApprovedNew(understanding.newDepartments)
    setStep('review')
  }

  const handleValidate = () =>
    run(async () => {
      setVerdict(await submitIntakeRows(baseUrl, companyId, rows, true, approvedNew))
    })

  const handleApprove = () =>
    run(async () => {
      const committed = await submitIntakeRows(baseUrl, companyId, rows, false, approvedNew)
      setResult(committed)
      setStep('done')
      onImported()
    })

  function patchRow(rowNumber: number, patch: Partial<IntakeRow>) {
    setRows((current) => current.map((row) => (row.rowNumber === rowNumber ? { ...row, ...patch } : row)))
    setVerdict(null)
  }

  function removeRow(rowNumber: number) {
    setRows((current) => current.filter((row) => row.rowNumber !== rowNumber))
    setVerdict(null)
  }

  function startOver() {
    setFile(null)
    setUnderstanding(null)
    setDraft(null)
    setEdited(new Set())
    setDirty(false)
    setFixes({})
    setAiOrigin(null)
    setRows([])
    setApprovedNew([])
    setReviewSource(null)
    setVerdict(null)
    setResult(null)
    setStep('upload')
  }

  const created = result ? createdDepartments(approvedNew, result) : []

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ol className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm text-fg-tertiary">
        {HEADER_STEPS.map((entry, index) => {
          const current = (entry.steps as readonly Step[]).includes(step)
          return (
            <li
              key={entry.key}
              aria-current={current ? 'step' : undefined}
              className={cn(current && 'font-semibold text-fg-primary')}
            >
              {t(`users.intake.step.${entry.key}`, { n: index + 1 })}
            </li>
          )
        })}
      </ol>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {step === 'upload' && (
        <UploadStep busy={busy} fileName={file?.name ?? null} onFile={handleFile} onDownloadTemplate={handleDownload} />
      )}

      {step === 'reading' && progress && (
        <UnderstandingProgress mode={progress.mode} startedAt={progress.startedAt} outcome={progress.outcome?.source ?? null} />
      )}

      {step === 'understand' && understanding && draft && (
        <UnderstandStep
          understanding={understanding}
          draft={draft}
          edited={edited}
          dirty={dirty}
          fixes={fixes}
          aiOrigin={aiOrigin}
          rowCount={fixedRows.length}
          busy={busy}
          onMappingChange={handleMappingChange}
          onApply={handleApply}
          onContinue={handleContinue}
          onBack={() => setStep('upload')}
          onFix={handleFix}
        />
      )}

      {step === 'review' && understanding && (
        <ReviewStep
          rows={rows}
          verdict={verdict}
          busy={busy}
          departments={understanding.targets.departments}
          newDepartments={approvedNew}
          demographicTargets={understanding.targets.demographics}
          onPatch={patchRow}
          onRemove={removeRow}
          onValidate={handleValidate}
          onApprove={handleApprove}
          onBack={() => setStep('understand')}
        />
      )}

      {step === 'done' && result && (
        <div className="flex flex-col gap-3">
          <p className="m-0 flex items-center gap-2 text-lg font-semibold text-fg-primary">
            <CircleCheck aria-hidden="true" className="size-5 text-accent-green" />
            {t('users.bulkImportSummary', {
              succeeded: result.successCount,
              errors: result.errorCount,
              total: result.rows.length,
            })}
          </p>
          <p className="m-0">{t('users.intake.doneBody')}</p>
          {created.length > 0 && (
            <p className="m-0 text-sm text-fg-secondary">
              {t('users.intake.done.departmentsCreated', { names: created.join(', ') })}
            </p>
          )}
          <div>
            <Button type="button" variant="secondary" onClick={startOver}>
              {t('users.intake.startOver')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
