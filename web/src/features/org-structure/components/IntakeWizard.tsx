import { useEffect, useMemo, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, Button } from '../../../components/ui'
import { cn } from '../../../lib/cn'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import {
  getIntakeTemplate,
  IMPORT_CHUNK_ROWS,
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
import {
  REQUEST_ERROR_CODES,
  applyDomainFixes,
  chunkForImport,
  createdDepartments,
  credentialsNotSent,
  mergeImportResponses,
} from './intake/intakeModel'

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
  /**
   * How the people in this file will reach the survey (ruled 2026-10-13).
   *
   * `invitation` is what every import did before: an email asking the person to choose their own
   * password. `credentials` is the mass invite — the platform generates a username and password,
   * emails both with the login link, and the file's demographics are already on the account, so
   * the survey never asks for them.
   *
   * Defaults to `invitation` deliberately. Mass invite creates live accounts and mails passwords;
   * that is not something an admin should trigger by not noticing a control.
   */
  const [accessMode, setAccessMode] = useState<'invitation' | 'credentials'>('invitation')
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
  /**
   * How far the approval has got, in rows whose request has come back. Null while nothing is
   * being committed. A file small enough for one request sets it too, and the screen simply
   * does not draw a count of one batch.
   */
  const [committing, setCommitting] = useState<{ done: number; total: number } | null>(null)

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
      setVerdict(
        await submitIntakeRows(baseUrl, companyId, rows, true, approvedNew, accessMode === 'credentials'),
      )
    })

  /**
   * Approves the reviewed rows, one request per `IMPORT_CHUNK_ROWS` of them.
   *
   * The constant says why the whole file cannot go in one request. What matters here is what
   * happens when a batch part-way through fails: every batch before it is already committed, so
   * those people have accounts and, on a mass invite, have been mailed their password. Reporting
   * that as a failure would read as "nothing happened" and invite a second run over people who
   * already exist — which is the one recovery that makes things worse. So the batches that
   * landed are shown on the done step exactly as a clean import is, and the message above them
   * says how far it got and what to do instead.
   *
   * The preview is deliberately NOT batched; `submitIntakeRows` carries that reasoning.
   */
  const handleApprove = () =>
    run(async () => {
      const batches = chunkForImport(rows)
      const landed: BulkImportResponse[] = []
      const finish = (committed: BulkImportResponse) => {
        setResult(committed)
        setStep('done')
        onImported()
      }

      setCommitting({ done: 0, total: rows.length })
      try {
        for (const batch of batches) {
          landed.push(
            await submitIntakeRows(baseUrl, companyId, batch, false, approvedNew, accessMode === 'credentials'),
          )
          setCommitting({ done: landed.reduce((n, part) => n + part.rows.length, 0), total: rows.length })
        }
      } catch (err) {
        if (landed.length === 0) {
          throw err
        }
        const committed = mergeImportResponses(landed)
        finish(committed)
        // Set after `run` has already cleared it, so it survives into the done step.
        setError(t('users.intake.stoppedPartWay', { done: committed.rows.length, total: rows.length }))
        return
      } finally {
        setCommitting(null)
      }

      finish(mergeImportResponses(landed))
    })

  function chooseAccessMode(mode: 'invitation' | 'credentials') {
    setAccessMode(mode)
    setVerdict(null)
  }

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
    setCommitting(null)
    setAccessMode('invitation')
    setStep('upload')
  }

  const created = result ? createdDepartments(approvedNew, result) : []
  // Who was given an account but never told. Only a real import can produce this, so it is
  // read here and not on the preview.
  const notSent = result ? credentialsNotSent(result) : []

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

      {committing !== null && committing.total > IMPORT_CHUNK_ROWS && (
        // A file that fits in one request says nothing: there is no progress to report, and a
        // line that appears and vanishes reads as something having gone wrong.
        <p role="status" className="m-0 text-sm text-fg-secondary">
          {t('users.intake.importingProgress', { done: committing.done, total: committing.total })}
        </p>
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
          accessMode={accessMode}
          onAccessModeChange={chooseAccessMode}
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
          {accessMode === 'credentials' && notSent.length > 0 ? (
            // Never beside the sentence that promises the credentials were emailed: for these
            // rows that promise is false, so this replaces it rather than contradicting it.
            <Alert variant="destructive">
              <AlertDescription>
                {t(
                  notSent.length === 1
                    ? 'users.intake.doneCredentialsNotSentOne'
                    : 'users.intake.doneCredentialsNotSentMany',
                  { count: notSent.length },
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <p className="m-0">
              {t(
                accessMode === 'credentials'
                  ? 'users.intake.doneBodyCredentials'
                  : 'users.intake.doneBody',
              )}
            </p>
          )}
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
