import { useEffect, useRef, useState } from 'react'
import { Link, useBlocker } from 'react-router'
import { PageTopBar } from '../../components/layout'
import { Alert, AlertDescription, Button, Input, Table } from '../../components/ui'
import { readViewerClaims, useViewerCapabilities } from '../../auth/viewerCapabilities'
import { useTranslation } from '../../i18n'
import { roleLabelKey } from '../org-structure/labels'
import { writeSelectedCompanyId } from '../../company-context'
import { applyClimateWorkbook, downloadClimateWorkbook, previewClimateWorkbook, type ClimateWorkbookPreview, type WorkbookProgress, type WorkbookResult } from './api/climateWorkbook'

const baseUrl = import.meta.env.VITE_API_BASE_URL

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
      if (fresh.companyId !== plan.companyId || fresh.surveyId !== plan.surveyId || JSON.stringify(fresh.existingPeople.map(p => `${p.id}:${p.role}`).sort()) !== JSON.stringify(plan.existingPeople.map(p => `${p.id}:${p.role}`).sort())) {
        setApproved(false); setError(t('climateWorkbook.changed')); return
      }
      setResult(await applyClimateWorkbook(baseUrl, fresh, setProgress))
    } catch (cause) { setError(`${message(cause)}\n${t('climateWorkbook.retryNote')}`); setApproved(false); setPlan(null) }
    finally { setBusy(false); setApplying(false); inFlight.current = false }
  }
  if (!canAuthorSurveys && readViewerClaims().role !== 'super_admin') return <Alert role="alert"><AlertDescription>{t('climateWorkbook.forbidden')}</AlertDescription></Alert>
  return <div className="mx-auto max-w-5xl space-y-6">
    <PageTopBar title={t('climateWorkbook.title')} description={t('climateWorkbook.description')} actions={<Button variant="outline" disabled={busy} onClick={() => void download()}>{t('climateWorkbook.download')}</Button>} />
    {!result && <section className="space-y-4 rounded-lg border border-line-default bg-surface-card p-6">
      <label className="block space-y-2"><span>{t('climateWorkbook.file')}</span><Input type="file" accept=".xlsx" disabled={busy} onChange={e => { setFile(e.target.files?.[0] ?? null); setPlan(null); setApproved(false); setError(null); setProgress(null) }} /></label>
      <p>{t('climateWorkbook.previewOnly')}</p>
      <Button disabled={!file || busy} onClick={() => void review()}>{t(busy ? 'common.loading' : 'climateWorkbook.review')}</Button>
    </section>}
    {error && <Alert variant="destructive" role="alert"><AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription></Alert>}
    {plan && !result && <section className="space-y-5 rounded-lg border border-line-default bg-surface-card p-6">
      <h2>{plan.content.title}</h2>
      <p>{plan.content.company.name} · {plan.content.company.emailDomain} · {plan.content.company.language} · {plan.content.company.timezone}</p>
      <p>{t('climateWorkbook.counts', { people: plan.content.people.length, questions: plan.content.questions.length, fields: plan.fields.length, created: plan.content.people.length - plan.existingPeople.length, reused: plan.existingPeople.length })}</p>
      <p>{t('climateWorkbook.dates', { start: plan.content.startDate, end: plan.content.endDate })}</p>
      <p>{t(plan.content.company.anonymous ? 'climateWorkbook.anonymous' : 'climateWorkbook.identified')}</p>
      <p>{t('climateWorkbook.bands', { low: plan.content.company.resultBands.opportunityMin, high: plan.content.company.resultBands.strengthMin, scale: plan.content.company.resultBands.scale === 'percent' ? '0–100' : '1–5' })}</p>
      <p>{t(plan.companyId ? 'climateWorkbook.existingCompany' : 'climateWorkbook.newCompany')}</p>
      <p>{t('climateWorkbook.credentials')}</p>
      <details><summary>{t('climateWorkbook.questions')}</summary><ol className="list-decimal space-y-2 pl-6">{plan.content.questions.map((q, i) => <li key={i}><strong>{q.category}</strong> · {typeof q.text === 'string' ? q.text : q.text.es ?? q.text.en} · {t(q.type === 'open_ended' ? 'climateWorkbook.openQuestion' : 'climateWorkbook.scaleQuestion')}</li>)}</ol></details>
      <details><summary>{t('climateWorkbook.fields')}</summary><ul>{plan.fields.map(f => <li key={f.field}>{f.label}: {f.options.map(o => o.label).join(', ')}</li>)}</ul></details>
      <details><summary>{t('climateWorkbook.people')}</summary><div className="max-h-96 overflow-auto"><Table><thead><tr>{['name', 'email', 'department', 'role'].map(k => <th key={k}>{t(`climateWorkbook.${k}`)}</th>)}</tr></thead><tbody>{plan.content.people.map(p => <tr key={p.email}><td>{p.name}</td><td>{p.email}</td><td>{p.department}</td><td>{t(roleLabelKey(plan.existingPeople.find(u => u.email.toLowerCase() === p.email.toLowerCase())?.role ?? p.role) ?? 'users.employee')}</td></tr>)}</tbody></Table></div></details>
      {plan.errors.length > 0 ? <Alert variant="destructive" role="alert"><AlertDescription><ul>{plan.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></AlertDescription></Alert> : <>
        <label className="flex items-start gap-3"><input type="checkbox" checked={approved} disabled={busy} onChange={e => setApproved(e.target.checked)} /><span>{t('climateWorkbook.approve')}</span></label>
        <Button disabled={!approved || busy} onClick={() => void apply()}>{t('climateWorkbook.apply')}</Button>
      </>}
    </section>}
    {progress && <div role="status" aria-live="polite"><p>{t(`climateWorkbook.stages.${progress.stage}`)} · {progress.done} / {progress.total}</p>{applying && <p>{t('climateWorkbook.keepOpen')}</p>}</div>}
    {result && <section className="space-y-4 rounded-lg border border-line-default p-6">
      <h2>{t('climateWorkbook.complete')}</h2>
      <p>{t('climateWorkbook.result', { total: result.total, created: result.created, reused: result.reused })}</p>
      <p>{t('climateWorkbook.delivery')}</p>
      {result.credentialsNotSent.length > 0 && <Alert variant="destructive"><AlertDescription>{t('climateWorkbook.emailFailures')}<ul>{result.credentialsNotSent.map(email => <li key={email}>{email}</li>)}</ul></AlertDescription></Alert>}
      <Button asChild><Link reloadDocument to={`/surveys/${result.surveyId}/distribution`} onClick={() => { if (readViewerClaims().role === 'super_admin') writeSelectedCompanyId(result.companyId) }}>{t('climateWorkbook.openDistribution')}</Link></Button>
    </section>}
  </div>
}
