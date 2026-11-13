import { useEffect, useId, useRef, useState } from 'react'
import { Link, useBlocker } from 'react-router'
import { Download } from 'lucide-react'
import { PageHeader } from '../../components/layout'
import { Alert, AlertDescription, Button, Note, Table, TableHead } from '../../components/ui'
import { readViewerClaims, useViewerCapabilities } from '../../auth/viewerCapabilities'
import { useTranslation } from '../../i18n'
import { roleLabelKey } from '../org-structure/labels'
import { writeSelectedCompanyId } from '../../company-context'
import { applyClimateWorkbook, downloadClimateWorkbook, previewClimateWorkbook, type ClimateWorkbookPreview, type WorkbookProgress, type WorkbookResult } from './api/climateWorkbook'

const baseUrl = import.meta.env.VITE_API_BASE_URL

/**
 * What the import will mail, and when, for the preview's credential mode. `null` from the
 * preview means the company does not exist yet; the one the import creates is `shared`.
 * Any other value is one this screen cannot describe, and approval is withheld.
 */
function modeCopy(mode: ClimateWorkbookPreview['credentialMode']): { mode: string; lines: string[] } | { unknown: string } {
  if (mode === 'per_survey') return { mode: 'climateWorkbook.mode.perSurvey', lines: ['climateWorkbook.mode.perSurveyMail', 'climateWorkbook.mode.perSurveyLater', 'climateWorkbook.mode.draft'] }
  if (mode === 'shared' || mode == null) return { mode: mode == null ? 'climateWorkbook.mode.newCompanyShared' : 'climateWorkbook.mode.shared', lines: ['climateWorkbook.mode.sharedMail', 'climateWorkbook.mode.draft'] }
  return { unknown: mode }
}

export default function ClimateWorkbookPage() {
  const { t } = useTranslation()
  const { canAuthorSurveys } = useViewerCapabilities()
  const [file, setFile] = useState<File | null>(null)
  const [plan, setPlan] = useState<ClimateWorkbookPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<WorkbookProgress | null>(null)
  const [result, setResult] = useState<WorkbookResult | null>(null)
  const inFlight = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const fileInputId = useId()
  const fileNameId = useId()
  // A tab close can interrupt a multi-batch import. Nothing is persisted in browser storage.
  useEffect(() => {
    if (!applying) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [applying])
  const blocker = useBlocker(applying)
  useEffect(() => { if (blocker.state === 'blocked') blocker.reset() }, [blocker])
  const message = (cause: unknown) => cause instanceof Error ? (cause.message.startsWith('climateWorkbook.') ? t(cause.message) : cause.message) : t('climateWorkbook.failed')
  async function download() {
    setBusy(true); setError(null)
    try {
      const blob = await downloadClimateWorkbook(baseUrl)
      const url = URL.createObjectURL(blob); const a = document.createElement('a')
      a.href = url; a.download = 'TIMS_NEXA_Clima_Integral.xlsx'; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }
  async function review() {
    if (!file || inFlight.current) return
    inFlight.current = true; setBusy(true); setError(null); setPlan(null); setApproved(false); setResult(null)
    try { setPlan(await previewClimateWorkbook(baseUrl, file)) }
    catch (cause) { setError(message(cause)) }
    finally { setBusy(false); inFlight.current = false }
  }
  async function apply() {
    if (!file || !plan || !approved || inFlight.current) return
    inFlight.current = true; setBusy(true); setApplying(true); setError(null)
    try {
      // Refresh before every attempt: committed accounts/surveys from an interrupted run
      // are now existing records and must never get a second password or duplicate invite.
      const fresh = await previewClimateWorkbook(baseUrl, file)
      setPlan(fresh)
      if (fresh.errors.length) return
      // A changed account set requires another review, not an unnoticed change to approval.
      if (fresh.companyId !== plan.companyId || fresh.surveyId !== plan.surveyId || (fresh.credentialMode ?? null) !== (plan.credentialMode ?? null) || JSON.stringify(fresh.existingPeople.map(p => `${p.id}:${p.role}`).sort()) !== JSON.stringify(plan.existingPeople.map(p => `${p.id}:${p.role}`).sort())) {
        setApproved(false); setError(t('climateWorkbook.changed')); return
      }
      setResult(await applyClimateWorkbook(baseUrl, fresh, setProgress))
    } catch (cause) { setError(`${message(cause)}\n${t('climateWorkbook.retryNote')}`); setApproved(false); setPlan(null) }
    finally { setBusy(false); setApplying(false); inFlight.current = false }
  }
  const access = plan ? modeCopy(plan.credentialMode) : null
  const goToCompany = () => { if (result && readViewerClaims().role === 'super_admin') writeSelectedCompanyId(result.companyId) }
  if (!canAuthorSurveys && readViewerClaims().role !== 'super_admin') return <Alert role="alert"><AlertDescription>{t('climateWorkbook.forbidden')}</AlertDescription></Alert>
  // The Apple board's surfaces: a `.card` (12px radius, the panel hairline, no shadow, 18/20px
  // padding) for each step, serif card titles, 15px body and 13px secondary lines.
  const CARD = 'flex flex-col gap-4 rounded-xl border border-line-panel bg-surface-card px-5 py-4.5'
  const CARD_TITLE = 'm-0 text-2xl'
  return <div className="flex flex-col">
    <PageHeader
      breadcrumbs={[{ label: t('navigation.surveys'), href: '/surveys' }, { label: t('climateWorkbook.title') }]}
      title={t('climateWorkbook.title')}
      description={t('climateWorkbook.description')}
      actions={<Button variant="outline" disabled={busy} onClick={() => void download()}><Download aria-hidden="true" />{t('climateWorkbook.download')}</Button>}
    />
    <div className="flex max-w-3xl flex-col gap-6">
    {!result && <section className={CARD}>
      <div className="flex flex-col gap-2">
        <label htmlFor={fileInputId} className="mb-0 text-sm font-semibold text-fg-primary">{t('climateWorkbook.file')}</label>
        {/* The browser's own picker prints «Choose File» / «No file chosen» in the viewer's
            browser language, which no catalogue reaches (the review of 12 Nov). It stays the
            control the label names and the one that holds the file, hidden; the outline
            Button opens it and the line beside it says, in our words, what was chosen. */}
        <input id={fileInputId} ref={fileInput} type="file" accept=".xlsx" disabled={busy} tabIndex={-1} className="sr-only" onChange={e => { setFile(e.target.files?.[0] ?? null); setPlan(null); setApproved(false); setError(null); setProgress(null) }} />
        <div className="flex min-w-0 items-center gap-3">
          <Button type="button" variant="outline" disabled={busy} aria-describedby={fileNameId} onClick={() => fileInput.current?.click()}>{t('climateWorkbook.chooseFile')}</Button>
          <span id={fileNameId} data-testid="workbook-file-name" className="min-w-0 truncate text-sm text-fg-secondary">{file?.name ?? t('climateWorkbook.noFileChosen')}</span>
        </div>
      </div>
      <p className="m-0 text-sm text-fg-secondary">{t('climateWorkbook.previewOnly')}</p>
      {/* The step's one primary until a plan is on screen; then the approval below holds it. */}
      <div><Button variant={plan ? 'outline' : 'primary'} disabled={!file || busy} onClick={() => void review()}>{t(busy ? 'common.loading' : 'climateWorkbook.review')}</Button></div>
    </section>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription></Alert>}
    {plan && !result && <section className={CARD}>
      {plan.errors.length > 0 ? <>
        <h2 className={CARD_TITLE}>{t('climateWorkbook.incompleteTitle')}</h2>
        <p className="m-0">{t('climateWorkbook.incompleteHelp')}</p>
        <Alert variant="destructive" role="alert"><AlertDescription><ul>{plan.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></AlertDescription></Alert>
      </> : <>
      <div className="flex flex-col gap-1">
        <h2 className={CARD_TITLE}>{plan.content.title}</h2>
        <p className="m-0 text-sm text-fg-secondary">{plan.content.company.name} · {plan.content.company.emailDomain} · {plan.content.company.language} · {plan.content.company.timezone}</p>
      </div>
      <div className="flex flex-col gap-2 tabular-nums">
        <p className="m-0">{t('climateWorkbook.counts', { people: plan.content.people.length, questions: plan.content.questions.length, fields: plan.fields.length, created: plan.content.people.length - plan.existingPeople.length, reused: plan.existingPeople.length })}</p>
        <p className="m-0">{t('climateWorkbook.dates', { start: plan.content.startDate, end: plan.content.endDate })}</p>
        <p className="m-0">{t(plan.content.company.anonymous ? 'climateWorkbook.anonymous' : 'climateWorkbook.identified')}</p>
        <p className="m-0">{t('climateWorkbook.bands', { low: plan.content.company.resultBands.opportunityMin, high: plan.content.company.resultBands.strengthMin, scale: plan.content.company.resultBands.scale === 'percent' ? '0–100' : '1–5' })}</p>
        <p className="m-0">{t(plan.companyId ? 'climateWorkbook.existingCompany' : 'climateWorkbook.newCompany')}</p>
      </div>
      {access && <Note data-testid="workbook-access"><div className="flex flex-col gap-2">
        <h3 className="m-0 text-base font-semibold">{t('climateWorkbook.mode.title')}</h3>
        {'unknown' in access
          ? <Alert variant="destructive" role="alert"><AlertDescription>{t('climateWorkbook.mode.unknown', { mode: access.unknown })}</AlertDescription></Alert>
          : <><p className="m-0">{t(access.mode)}</p><ul className="m-0 list-disc space-y-1 pl-6">{access.lines.map(line => <li key={line}>{t(line)}</li>)}</ul></>}
      </div></Note>}
      <p className="m-0 text-sm text-fg-secondary">{t('climateWorkbook.credentials')}</p>
      </>}
      <details className="border-t border-line-default pt-3"><summary className="cursor-pointer font-medium">{t('climateWorkbook.questions')}</summary><ol className="mt-2 list-decimal space-y-2 pl-6 text-sm">{plan.content.questions.map((q, i) => <li key={i}><strong>{q.category}</strong> · {typeof q.text === 'string' ? q.text : q.text.es ?? q.text.en} · {t(q.type === 'open_ended' ? 'climateWorkbook.openQuestion' : 'climateWorkbook.scaleQuestion')}</li>)}</ol></details>
      {plan.errors.length === 0 && access && !('unknown' in access) && <>
      <details className="border-t border-line-default pt-3"><summary className="cursor-pointer font-medium">{t('climateWorkbook.fields')}</summary><ul className="mt-2 list-disc space-y-1 pl-6 text-sm">{plan.fields.map(f => <li key={f.field}>{f.label}: {f.options.map(o => o.label).join(', ')}</li>)}</ul></details>
      <details className="border-t border-line-default pt-3"><summary className="cursor-pointer font-medium">{t('climateWorkbook.people')}</summary><div className="mt-2 max-h-96 overflow-auto"><Table zebra className="text-sm"><thead><tr>{['name', 'email', 'department', 'role'].map(k => <TableHead key={k} className="border-b border-line-default">{t(`climateWorkbook.${k}`)}</TableHead>)}</tr></thead><tbody>{plan.content.people.map(p => <tr key={p.email}><td>{p.name}</td><td>{p.email}</td><td>{p.department}</td><td>{t(roleLabelKey(plan.existingPeople.find(u => u.email.toLowerCase() === p.email.toLowerCase())?.role ?? p.role) ?? 'users.employee')}</td></tr>)}</tbody></Table></div></details>
        <label className="mb-0 flex items-start gap-3 border-t border-line-default pt-4"><input type="checkbox" checked={approved} disabled={busy} onChange={e => setApproved(e.target.checked)} className="mt-1 size-4 shrink-0 accent-accent-blue-fill" /><span>{t('climateWorkbook.approve')}</span></label>
        <div><Button variant="primary" disabled={!approved || busy} onClick={() => void apply()}>{t('climateWorkbook.apply')}</Button></div>
      </>}
    </section>}
    {progress && <div role="status" aria-live="polite" className="flex flex-col gap-1"><p className="m-0 tabular-nums">{t(`climateWorkbook.stages.${progress.stage}`)} · {progress.done} / {progress.total}</p>{applying && <p className="m-0 text-sm text-fg-secondary">{t('climateWorkbook.keepOpen')}</p>}</div>}
    {result && <section className={CARD}>
      <h2 className={CARD_TITLE}>{t('climateWorkbook.complete')}</h2>
      <p className="m-0 tabular-nums">{t('climateWorkbook.result', { total: result.total, created: result.created, reused: result.reused })}</p>
      {result.credentialMode === 'per_survey'
        ? <p className="m-0">{t('climateWorkbook.deliveryPerSurvey')}</p>
        : <p className="m-0">{t('climateWorkbook.deliveryShared')} {t('climateWorkbook.delivery')}</p>}
      {result.credentialsNotSent.length > 0 && <Alert variant="destructive"><AlertDescription>{t('climateWorkbook.emailFailures')}<ul>{result.credentialsNotSent.map(email => <li key={email}>{email}</li>)}</ul></AlertDescription></Alert>}
      <h3 className="m-0 font-display text-xl font-semibold tracking-title">{t('climateWorkbook.draftTitle')}</h3>
      <p className="m-0">{t('climateWorkbook.nextStep')}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="primary"><Link reloadDocument to={`/surveys/${result.surveyId}`} onClick={goToCompany}>{t('climateWorkbook.openSurvey')}</Link></Button>
        <Button asChild variant="outline"><Link reloadDocument to={`/surveys/${result.surveyId}/distribution`} onClick={goToCompany}>{t('climateWorkbook.openDistribution')}</Link></Button>
      </div>
    </section>}
    </div>
  </div>
}
