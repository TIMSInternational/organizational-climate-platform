import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { FileSpreadsheet, Lock, Search, Shield } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { PageHeader } from '../../../components/layout'
import WizardStepper, { type WizardStep } from '../../../components/wizard/WizardStepper'
import {
  Button,
  Checkbox,
  Chip,
  Input,
  Note,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  Switch,
} from '../../../components/ui'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import { readViewerClaims } from '../../../auth/viewerCapabilities'
import { useCompanyContext } from '../../../company-context'
import { listCompanies, type Company } from '../../org-structure/api/companies'
import { listDemographicFields, type DemographicField } from '../../org-structure/api/demographicFields'
import { listSurveys, type SurveyListItem } from '../api/surveys'
import { EXPORT_FILES, exportBundleFallbackName, getExportBundle, type ExportFile } from '../api/exportBundle'
import { statusLabel } from '../surveyVocabulary'
import {
  exportWizardErrors,
  exportWizardSteps,
  filesFor,
  initialExportWizardState,
  toExportChoice,
  type ExportWizardState,
} from './exportWizardModel'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string

/**
 * «Descargar en Excel» -- the download wizard of the 14 Nov 2026 canvas (`ExportWizard.dc.html`).
 *
 * TIMS picks the company; a client's administrator starts at their own surveys. Then which
 * surveys, which of the four workbooks, each one's details, and one download: a workbook
 * alone, or a .zip when there are several (`GET /admin/companies/{id}/exports/bundle`).
 *
 * «Respuestas por persona» is offered to TIMS only, because the server refuses it to anyone
 * else: it is the one file in the product with comments as they were written (ruled
 * 2026-10-16). A client's administrator never sees the option rather than meeting a 403.
 */
export default function ExportWizardPage() {
  const { t, locale } = useTranslation()
  const claims = readViewerClaims()
  const isSuperAdmin = claims.role === 'super_admin'
  const { selectedCompanyId } = useCompanyContext()
  const steps = exportWizardSteps(isSuperAdmin)
  const [state, setState] = useState<ExportWizardState>(() =>
    initialExportWizardState(isSuperAdmin ? selectedCompanyId : (claims.companyId ?? null), isSuperAdmin, locale === 'en' ? 'en' : 'es'),
  )
  const [stepIndex, setStepIndex] = useState(0)
  const [companies, setCompanies] = useState<Company[] | null>(null)
  const [companySearch, setCompanySearch] = useState('')
  const [surveys, setSurveys] = useState<SurveyListItem[] | null>(null)
  const [surveysFailed, setSurveysFailed] = useState(false)
  const [fields, setFields] = useState<DemographicField[]>([])
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<'done' | 'failed' | null>(null)

  useEffect(() => {
    if (!isSuperAdmin) return
    let cancelled = false
    listCompanies(API_BASE_URL)
      .then((rows) => {
        if (!cancelled) setCompanies([...rows].sort((a, b) => a.name.localeCompare(b.name, locale)))
      })
      .catch(() => {
        if (!cancelled) setCompanies([])
      })
    return () => {
      cancelled = true
    }
  }, [isSuperAdmin, locale])

  useEffect(() => {
    if (!state.companyId) return
    const companyId = state.companyId
    let cancelled = false
    setSurveys(null)
    setSurveysFailed(false)
    setFields([])
    listSurveys(API_BASE_URL, { companyId }, locale)
      .then((rows) => {
        if (!cancelled) {
          setSurveys(rows.filter((row) => row.companyId === companyId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
        }
      })
      .catch(() => {
        if (!cancelled) setSurveysFailed(true)
      })
    listDemographicFields(API_BASE_URL, companyId, locale)
      .then((rows) => {
        if (!cancelled) setFields(rows.filter((field) => field.isActive))
      })
      .catch(() => {
        // The groups step then offers the department alone, which every company has.
      })
    return () => {
      cancelled = true
    }
  }, [state.companyId, locale])

  const distributed = useMemo(() => (surveys ?? []).filter((survey) => survey.status !== 'draft'), [surveys])
  const errors = exportWizardErrors(state, surveys === null ? null : distributed.length)
  const wizardSteps: WizardStep[] = steps.map((step) => ({
    id: step,
    label: t(`exportWizard.steps.${step}.label`),
    description: t(`exportWizard.steps.${step}.description`),
    errors: errors[step].map((key) => t(`exportWizard.errors.${key}`)),
  }))
  const step = steps[stepIndex]
  const company = companies?.find((row) => row.id === state.companyId) ?? null
  const companyName = company?.name ?? ''
  const choice = toExportChoice(state, isSuperAdmin)
  const chosenSurveys = state.surveyMode === 'all' ? distributed : distributed.filter((survey) => state.surveyIds.includes(survey.id))
  const responses = chosenSurveys.reduce((sum, survey) => sum + survey.responseCount, 0)
  const groupOptions = [
    { field: 'department', label: t('exportWizard.details.department') },
    ...fields.map((field) => ({ field: field.field, label: field.label ?? field.field })),
  ]

  function update(patch: Partial<ExportWizardState>) {
    setOutcome(null)
    setState((current) => ({ ...current, ...patch }))
  }

  function toggle<T>(list: readonly T[], value: T): T[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
  }

  async function download() {
    if (!state.companyId) return
    setBusy(true)
    setOutcome(null)
    try {
      const { blob, fileName } = await getExportBundle(API_BASE_URL, state.companyId, choice)
      downloadBlobFile(fileName ?? exportBundleFallbackName(choice, companyName, new Date()), blob)
      setOutcome('done')
    } catch {
      setOutcome('failed')
    } finally {
      setBusy(false)
    }
  }

  const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const day = (value: string) => dateFormat.format(new Date(value))
  const visibleCompanies = (companies ?? []).filter((row) =>
    row.name.toLocaleLowerCase(locale).includes(companySearch.trim().toLocaleLowerCase(locale)),
  )

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t('exportWizard.crumbSurveys'), href: '/surveys' }, { label: t('exportWizard.title') }]}
        eyebrow={t('exportWizard.eyebrow')}
        title={t('exportWizard.title')}
        description={isSuperAdmin ? t('exportWizard.description') : t('exportWizard.descriptionOwn')}
        actions={
          <Button asChild variant="outline">
            <Link to="/surveys">{t('exportWizard.cancel')}</Link>
          </Button>
        }
      />

      <WizardStepper
        steps={wizardSteps}
        currentIndex={stepIndex}
        onNavigate={setStepIndex}
        onSubmit={() => void download()}
        submitLabel={busy ? t('exportWizard.submitting') : choice.files.length > 1 ? t('exportWizard.submitZip') : t('exportWizard.submit')}
        progressLabel={t('exportWizard.progress', { current: stepIndex + 1, total: steps.length })}
        submitting={busy}
        stepListLabel={t('exportWizard.stepList')}
        aside={
          <section aria-labelledby="export-summary-title" className="rounded-xl border border-line-light bg-surface-card p-card">
            <h2 id="export-summary-title" className="m-0 text-base font-semibold">
              {t('exportWizard.aside.title')}
            </h2>
            <dl className="m-0 mt-3 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-fg-secondary">{t('exportWizard.aside.company')}</dt>
              <dd className="m-0">{isSuperAdmin ? companyName || '—' : t('exportWizard.aside.ownCompany')}</dd>
              <dt className="text-fg-secondary">{t('exportWizard.aside.surveys')}</dt>
              <dd className="m-0">
                {surveys === null
                  ? '—'
                  : t('exportWizard.aside.surveysCount', { count: chosenSurveys.length, total: distributed.length, responses })}
              </dd>
              <dt className="text-fg-secondary">{t('exportWizard.aside.files')}</dt>
              <dd className="m-0">
                {choice.files.length === 0
                  ? '—'
                  : choice.files.length === 1
                    ? t('exportWizard.aside.oneFile')
                    : t('exportWizard.aside.zip', { count: choice.files.length })}
              </dd>
            </dl>
          </section>
        }
      >
        {step === 'company' && (
          <div className="flex flex-col gap-4">
            <label className="flex items-center gap-2 rounded-lg border border-line-default px-3">
              <Search aria-hidden="true" className="size-4 text-fg-secondary" />
              <Input
                type="search"
                className="border-0 shadow-none"
                value={companySearch}
                placeholder={t('exportWizard.company.search')}
                aria-label={t('exportWizard.company.search')}
                onChange={(event) => setCompanySearch(event.target.value)}
              />
            </label>
            {companies === null ? (
              <p className="m-0 text-sm text-fg-secondary">{t('exportWizard.company.loading')}</p>
            ) : (
              <RadioGroup
                value={state.companyId ?? ''}
                onValueChange={(companyId) => update({ companyId, surveyMode: 'all', surveyIds: [], groups: ['department'] })}
                className="flex flex-col gap-2"
              >
                {visibleCompanies.map((row) => (
                  <label
                    key={row.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-line-light px-3.5 py-3 has-[[data-state=checked]]:border-accent-blue"
                  >
                    <RadioGroupItem value={row.id} aria-label={row.name} />
                    <span className="font-semibold">{row.name}</span>
                  </label>
                ))}
                {visibleCompanies.length === 0 && <p className="m-0 text-sm text-fg-secondary">{t('exportWizard.company.none')}</p>}
              </RadioGroup>
            )}
          </div>
        )}

        {step === 'surveys' && (
          <div className="flex flex-col gap-4">
            {surveysFailed ? (
              <p className="m-0 text-sm text-accent-red-ink" role="alert">
                {t('exportWizard.surveys.loadFailed')}
              </p>
            ) : surveys === null ? (
              <p className="m-0 text-sm text-fg-secondary">{t('exportWizard.surveys.loading')}</p>
            ) : (
              <>
                <SegmentedControl
                  label={t('exportWizard.surveys.label')}
                  value={state.surveyMode}
                  options={[
                    { value: 'all', label: t('exportWizard.surveys.all', { count: distributed.length }) },
                    { value: 'chosen', label: t('exportWizard.surveys.chosen') },
                  ]}
                  onChange={(surveyMode) =>
                    update({
                      surveyMode,
                      surveyIds: surveyMode === 'chosen' && state.surveyIds.length === 0 ? distributed.map((survey) => survey.id) : state.surveyIds,
                    })
                  }
                />
                <div className="overflow-x-auto rounded-lg border border-line-light">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-fg-secondary">
                        <th scope="col" className="w-10 px-3 py-2">
                          <span className="sr-only">{t('exportWizard.surveys.include')}</span>
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">{t('exportWizard.surveys.survey')}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{t('exportWizard.surveys.status')}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t('exportWizard.surveys.responses')}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{t('exportWizard.surveys.dates')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {surveys.map((survey) => {
                        const draft = survey.status === 'draft'
                        const title = survey.title ?? t('exportWizard.surveys.untitled')
                        const ticked = !draft && (state.surveyMode === 'all' || state.surveyIds.includes(survey.id))
                        return (
                          <tr key={survey.id} className="border-t border-line-light">
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={ticked}
                                disabled={draft || state.surveyMode === 'all'}
                                aria-label={draft ? t('exportWizard.surveys.draftLabel', { title }) : t('exportWizard.surveys.includeOne', { title })}
                                onCheckedChange={() => update({ surveyIds: toggle(state.surveyIds, survey.id) })}
                              />
                            </td>
                            <td className={draft ? 'px-3 py-2 text-fg-secondary' : 'px-3 py-2 font-semibold'}>{title}</td>
                            <td className="px-3 py-2">
                              <Chip label={statusLabel(t, survey.status)} tone={survey.status === 'active' ? 'live' : undefined} />
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{draft ? '—' : survey.responseCount}</td>
                            <td className="px-3 py-2 text-fg-secondary">
                              {draft ? t('exportWizard.surveys.draftNote') : `${day(survey.startDate)} – ${day(survey.endDate)}`}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'files' && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {filesFor(isSuperAdmin).map((file) => {
                const id = `export-file-${file}`
                return (
                  <label
                    key={file}
                    htmlFor={id}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-light px-3.5 py-3"
                  >
                    <Checkbox
                      id={id}
                      className="mt-1"
                      checked={state.files.includes(file)}
                      onCheckedChange={() => update({ files: toggle(state.files, file) })}
                    />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 font-semibold">
                        {t(`exportWizard.files.${file}.title`)}
                        {file === 'responses' && <Chip label={t('exportWizard.files.timsOnly')} icon={<Lock />} />}
                      </span>
                      <span className="text-sm text-fg-secondary">{t(`exportWizard.files.${file}.body`)}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            {isSuperAdmin && <Note icon={<Lock aria-hidden="true" />}>{t('exportWizard.files.responsesNote')}</Note>}
          </div>
        )}

        {step === 'details' && (
          <div className="flex flex-col gap-4">
            <ul className="m-0 flex list-none flex-col divide-y divide-line-light rounded-lg border border-line-light p-0">
              {choice.files.includes('responses') && (
                <li className="flex flex-wrap items-start justify-between gap-3 px-3.5 py-3">
                  <span className="flex flex-col">
                    <span className="font-semibold">{t('exportWizard.files.responses.title')}</span>
                    <span className="text-sm text-fg-secondary">{t('exportWizard.details.responsesHint')}</span>
                  </span>
                  <label className="flex items-center gap-2.5 text-sm">
                    <Switch checked={state.includeAnswers} onCheckedChange={(includeAnswers) => update({ includeAnswers })} />
                    {t('exportWizard.details.includeAnswers')}
                  </label>
                </li>
              )}
              {choice.files.includes('status') && (
                <li className="flex flex-wrap items-start justify-between gap-3 px-3.5 py-3">
                  <span className="flex flex-col">
                    <span className="font-semibold">{t('exportWizard.files.status.title')}</span>
                    <span className="text-sm text-fg-secondary">{t('exportWizard.details.statusHint')}</span>
                  </span>
                  <SegmentedControl
                    label={t('exportWizard.details.statusFormat')}
                    value={state.statusFormat}
                    options={[
                      { value: 'standard', label: t('exportWizard.details.standard') },
                      { value: 'progress', label: t('exportWizard.details.progress') },
                    ]}
                    onChange={(statusFormat) => update({ statusFormat })}
                  />
                </li>
              )}
              {choice.files.includes('results') && (
                <li className="flex flex-wrap items-start justify-between gap-3 px-3.5 py-3">
                  <span className="flex flex-col">
                    <span className="font-semibold">{t('exportWizard.files.results.title')}</span>
                    <span className="text-sm text-fg-secondary">{t('exportWizard.details.groupsHint')}</span>
                  </span>
                  <span className="flex flex-col gap-2">
                    {groupOptions.map((option) => {
                      const id = `export-group-${option.field}`
                      return (
                        <label key={option.field} htmlFor={id} className="flex items-center gap-2.5 text-sm">
                          <Checkbox
                            id={id}
                            checked={state.groups.includes(option.field)}
                            onCheckedChange={() => update({ groups: toggle(state.groups, option.field) })}
                          />
                          {option.label}
                        </label>
                      )
                    })}
                  </span>
                </li>
              )}
              <li className="flex flex-wrap items-start justify-between gap-3 px-3.5 py-3">
                <span className="flex flex-col">
                  <span className="font-semibold">{t('exportWizard.details.language')}</span>
                  <span className="text-sm text-fg-secondary">{t('exportWizard.details.languageHint')}</span>
                </span>
                <SegmentedControl
                  label={t('exportWizard.details.language')}
                  value={state.lang}
                  options={[
                    { value: 'es', label: t('exportWizard.details.spanish') },
                    { value: 'en', label: t('exportWizard.details.english') },
                  ]}
                  onChange={(lang) => update({ lang })}
                />
              </li>
            </ul>
            {choice.files.includes('results') && (
              <Note tone="info" icon={<Shield aria-hidden="true" />}>
                {t('exportWizard.details.resultsNote')}
              </Note>
            )}
          </div>
        )}

        {step === 'download' && (
          <div className="flex flex-col gap-4">
            <ul className="m-0 flex list-none flex-col divide-y divide-line-light rounded-lg border border-line-light p-0">
              {EXPORT_FILES.filter((file: ExportFile) => choice.files.includes(file)).map((file) => (
                <li key={file} className="flex items-center gap-3 px-3.5 py-3" data-slot="export-file">
                  <FileSpreadsheet aria-hidden="true" className="size-4 shrink-0 text-fg-secondary" />
                  <span className="flex min-w-0 grow flex-col">
                    <span className="font-semibold">{t(`exportWizard.files.${file}.title`)}</span>
                    <span className="text-sm text-fg-secondary">
                      {t('exportWizard.download.sheets', { count: chosenSurveys.length })}
                    </span>
                  </span>
                  {file === 'responses' && <Chip label={t('exportWizard.files.timsOnly')} icon={<Lock />} />}
                </li>
              ))}
            </ul>
            <p className="m-0 text-sm text-fg-secondary">
              {choice.files.length > 1 ? t('exportWizard.download.zipNote', { count: choice.files.length }) : t('exportWizard.download.oneNote')}
            </p>
            {outcome === 'done' && (
              <p className="m-0 text-sm text-accent-green-ink" role="status">
                {t('exportWizard.download.done')}
              </p>
            )}
            {outcome === 'failed' && (
              <p className="m-0 text-sm text-accent-red-ink" role="alert">
                {t('exportWizard.download.failed')}
              </p>
            )}
          </div>
        )}
      </WizardStepper>
    </div>
  )
}
