import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Lock, Shield } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { PageHeader } from '../../../components/layout'
import WizardStepper, { type WizardStep } from '../../../components/wizard/WizardStepper'
import {
  Button,
  Checkbox,
  Chip,
  Note,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  Switch,
  Table,
} from '../../../components/ui'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import { useCompanyNameFor } from '../../../company-context'
import { listSurveys, type SurveyListItem } from '../../surveys/api/surveys'
import { statusLabel } from '../../surveys/surveyVocabulary'
import {
  getSurveyReportOptions,
  getSurveyReportPdf,
  getSurveyReportPreview,
  surveyReportFileName,
  type SurveyReportChoice,
  type SurveyReportOptions,
  type SurveyReportPreview,
  type SurveyReportSection,
} from '../api/surveyReport'
import {
  REPORT_WIZARD_STEPS,
  addCross,
  initialReportWizardState,
  reportWizardErrors,
  suggestedCrosses,
  toReportChoice,
  toggled,
  variableLabel,
  type ReportWizardState,
} from './reportWizardModel'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string

/** The sections in the order the «Contenido» step lists them, which is the order the PDF prints them. */
const SECTION_ORDER: readonly SurveyReportSection[] = [
  'summary',
  'dimensions',
  'map',
  'comparison',
  'crosses',
  'questions',
  'highlights',
  'comments',
]

const PREVIEW_DELAY_MS = 450

/**
 * «Generar informe» -- the report wizard of the 14 Nov 2026 canvas (`ReportWizard.dc.html`).
 *
 * Five steps on the shared `WizardStepper`: the survey (and an earlier one to compare with),
 * which departments get rows, which crosses, which sections, and a review. The aside is a
 * measurement, not an estimate: every change asks `GET /surveys/{id}/report/preview`, which
 * renders the very PDF the last step downloads and returns its page count and how many cross
 * cells are protected.
 *
 * Nothing about disclosure is decided here. The server computes every cell through the
 * results screen's own aggregation; this page only counts what it was told.
 */
export default function ReportWizardPage() {
  const { companyId = '' } = useParams<{ companyId: string }>()
  const { t, locale } = useTranslation()
  const companyName = useCompanyNameFor(companyId)
  const [state, setState] = useState<ReportWizardState>(() => initialReportWizardState(locale === 'en' ? 'en' : 'es'))
  const [stepIndex, setStepIndex] = useState(0)
  const [surveys, setSurveys] = useState<SurveyListItem[] | null>(null)
  const [surveysFailed, setSurveysFailed] = useState(false)
  const [options, setOptions] = useState<SurveyReportOptions | null>(null)
  const [optionsFailed, setOptionsFailed] = useState(false)
  const [preview, setPreview] = useState<SurveyReportPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<'done' | 'failed' | null>(null)
  const [crossRow, setCrossRow] = useState('')
  const [crossColumn, setCrossColumn] = useState('')

  // «Generar informe» on a survey's results page arrives with `?survey=<id>`: that survey is
  // chosen as soon as the list loads -- but only if the list offers it. A draft, a survey nobody
  // answered or another company's id is ignored, never forced past the filter below.
  const [searchParams] = useSearchParams()
  const askedSurvey = searchParams.get('survey')
  useEffect(() => {
    if (!askedSurvey || state.surveyId || !surveys?.some((survey) => survey.id === askedSurvey)) return
    setPreview(null)
    setState((previous) => ({ ...previous, surveyId: askedSurvey, compareSurveyId: null, scope: 'all', departmentIds: [], crosses: [] }))
  }, [askedSurvey, surveys, state.surveyId])

  useEffect(() => {
    let cancelled = false
    setSurveys(null)
    setSurveysFailed(false)
    listSurveys(API_BASE_URL, { companyId }, locale)
      .then((rows) => {
        if (cancelled) return
        // Only surveys with something to tell: a draft has no answers, and a survey nobody has
        // answered yet would be a report of zeros.
        setSurveys(
          rows
            .filter((row) => row.companyId === companyId && row.status !== 'draft' && row.responseCount > 0)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        )
      })
      .catch(() => {
        if (!cancelled) setSurveysFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, locale])

  useEffect(() => {
    if (!state.surveyId) return
    let cancelled = false
    setOptions(null)
    setOptionsFailed(false)
    getSurveyReportOptions(API_BASE_URL, state.surveyId, state.lang)
      .then((loaded) => {
        if (cancelled) return
        setOptions(loaded)
        const first = loaded.variables[0]?.field ?? ''
        setCrossRow(first)
        setCrossColumn(loaded.variables.find((variable) => variable.field !== first)?.field ?? '')
      })
      .catch(() => {
        if (!cancelled) setOptionsFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [state.surveyId, state.lang])

  const choice = useMemo(() => toReportChoice(state), [state])
  // The preview re-asks when the CONTENTS of the choice change, not its identity: a fresh
  // object with the same sections and crosses must not cost another render of the PDF.
  const choiceKey = JSON.stringify(choice)

  useEffect(() => {
    if (!state.surveyId || !options) return
    const surveyId = state.surveyId
    const controller = new AbortController()
    setPreviewBusy(true)
    const timer = setTimeout(() => {
      getSurveyReportPreview(API_BASE_URL, surveyId, JSON.parse(choiceKey) as SurveyReportChoice, controller.signal)
        .then((loaded) => setPreview(loaded))
        .catch(() => {
          if (!controller.signal.aborted) setPreview(null)
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewBusy(false)
        })
    }, PREVIEW_DELAY_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [state.surveyId, options, choiceKey])

  const errors = reportWizardErrors(state, options)
  const steps: WizardStep[] = REPORT_WIZARD_STEPS.map((step) => ({
    id: step,
    label: t(`reportWizard.steps.${step}.label`),
    description: t(`reportWizard.steps.${step}.description`),
    errors: errors[step].map((key) => t(`reportWizard.errors.${key}`)),
  }))

  const selectedSurvey = surveys?.find((survey) => survey.id === state.surveyId) ?? null
  const variables = options?.variables ?? []
  const maxCrosses = options?.maxCrosses ?? 4

  function update(patch: Partial<ReportWizardState>) {
    setOutcome(null)
    setState((current) => ({ ...current, ...patch }))
  }

  function chooseSurvey(id: string) {
    setPreview(null)
    // Everything below the survey belongs to the survey: its departments, its variables and
    // its comparison are another survey's lists once it changes.
    update({ surveyId: id, compareSurveyId: null, scope: 'all', departmentIds: [], crosses: [] })
  }

  async function generate() {
    if (!state.surveyId) return
    setSubmitting(true)
    setOutcome(null)
    try {
      const blob = await getSurveyReportPdf(API_BASE_URL, state.surveyId, choice)
      downloadBlobFile(surveyReportFileName(options?.title ?? selectedSurvey?.title ?? null, state.lang), blob)
      setOutcome('done')
    } catch {
      setOutcome('failed')
    } finally {
      setSubmitting(false)
    }
  }

  const dateFormat = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const day = (value: string | null | undefined) => (value ? dateFormat.format(new Date(value)) : '')
  const reportsHref = `/admin/companies/${encodeURIComponent(companyId)}/reports`

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: t('reportWizard.crumbReports'), href: reportsHref }, { label: t('reportWizard.title') }]}
        eyebrow={companyName ?? t('reportWizard.crumbReports')}
        title={t('reportWizard.title')}
        description={t('reportWizard.description')}
        actions={
          <Button asChild variant="outline">
            <Link to={reportsHref}>{t('reportWizard.cancel')}</Link>
          </Button>
        }
      />

      <WizardStepper
        steps={steps}
        currentIndex={stepIndex}
        onNavigate={setStepIndex}
        onSubmit={() => void generate()}
        submitLabel={submitting ? t('reportWizard.submitting') : t('reportWizard.submit')}
        progressLabel={t('reportWizard.progress', { current: stepIndex + 1, total: steps.length })}
        submitting={submitting}
        stepListLabel={t('reportWizard.stepList')}
        aside={
          <ReportAside
            hasSurvey={Boolean(state.surveyId && options)}
            preview={preview}
            busy={previewBusy}
          />
        }
      >
        {stepIndex === 0 && (
          <div className="flex flex-col gap-5">
            {surveysFailed ? (
              <p className="m-0 text-sm text-accent-red-ink" role="alert">
                {t('reportWizard.survey.loadFailed')}
              </p>
            ) : surveys === null ? (
              <p className="m-0 text-sm text-fg-secondary">{t('reportWizard.survey.loading')}</p>
            ) : surveys.length === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{t('reportWizard.survey.none')}</p>
            ) : (
              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="mb-2 text-sm font-semibold">{t('reportWizard.survey.legend')}</legend>
                <RadioGroup value={state.surveyId ?? ''} onValueChange={chooseSurvey} className="flex flex-col gap-2">
                  {surveys.map((survey) => (
                    <label
                      key={survey.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-line-light px-3.5 py-3 has-[[data-state=checked]]:border-accent-blue"
                    >
                      <RadioGroupItem value={survey.id} aria-label={survey.title ?? t('reportWizard.survey.untitled')} />
                      <span className="flex min-w-0 grow flex-col">
                        <span className="font-semibold">{survey.title ?? t('reportWizard.survey.untitled')}</span>
                        <span className="text-sm text-fg-secondary">
                          {[
                            `${day(survey.startDate)} – ${day(survey.endDate)}`,
                            survey.targetAudienceCount
                              ? t('reportWizard.survey.responsesOf', { count: survey.responseCount, total: survey.targetAudienceCount })
                              : t('reportWizard.survey.responses', { count: survey.responseCount }),
                          ].join(' · ')}
                        </span>
                      </span>
                      <Chip label={statusLabel(t, survey.status)} tone={survey.status === 'active' ? 'live' : undefined} />
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>
            )}

            {optionsFailed && (
              <p className="m-0 text-sm text-accent-red-ink" role="alert">
                {t('reportWizard.survey.optionsFailed')}
              </p>
            )}
            {options?.isSuppressed && <Note icon={<Shield aria-hidden="true" />}>{t('reportWizard.survey.suppressed')}</Note>}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t('reportWizard.survey.compare')}
                <select
                  className="h-8 rounded-md border border-line-default bg-surface-card px-2 text-base text-fg-primary"
                  value={state.compareSurveyId ?? ''}
                  disabled={!options}
                  onChange={(event) => update({ compareSurveyId: event.target.value || null })}
                >
                  <option value="">{t('reportWizard.survey.compareNone')}</option>
                  {(options?.comparableSurveys ?? []).map((survey) => (
                    <option key={survey.id} value={survey.id}>
                      {survey.title ?? t('reportWizard.survey.untitled')}
                    </option>
                  ))}
                </select>
                <span className="text-xs font-normal text-fg-secondary">{t('reportWizard.survey.compareHint')}</span>
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t('reportWizard.survey.language')}</span>
                <SegmentedControl
                  label={t('reportWizard.survey.language')}
                  value={state.lang}
                  options={[
                    { value: 'es', label: t('reportWizard.survey.spanish') },
                    { value: 'en', label: t('reportWizard.survey.english') },
                  ]}
                  onChange={(lang) => update({ lang })}
                />
              </div>
            </div>
          </div>
        )}

        {stepIndex === 1 && (
          <div className="flex flex-col gap-4">
            <SegmentedControl
              label={t('reportWizard.scope.label')}
              value={state.scope}
              options={[
                { value: 'all', label: t('reportWizard.scope.all') },
                { value: 'chosen', label: t('reportWizard.scope.chosen'), disabled: (options?.departments.length ?? 0) === 0 },
              ]}
              onChange={(scope) =>
                update({
                  scope,
                  departmentIds: scope === 'chosen' && state.departmentIds.length === 0
                    ? (options?.departments ?? []).map((department) => department.id)
                    : state.departmentIds,
                })
              }
            />
            {(options?.departments.length ?? 0) === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{t('reportWizard.scope.noDepartments')}</p>
            ) : (
              state.scope === 'chosen' && (
                <div className="overflow-x-auto rounded-lg border border-line-light">
                  <Table className="border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-fg-secondary">
                        <th scope="col" className="w-10 px-3 py-2">
                          <span className="sr-only">{t('reportWizard.scope.includeColumn')}</span>
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">{t('reportWizard.scope.department')}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t('reportWizard.scope.respondents')}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t('reportWizard.scope.headcount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {options!.departments.map((department) => {
                        const name = department.name ?? t('reportWizard.scope.unnamed')
                        const ticked = state.departmentIds.includes(department.id)
                        return (
                          <tr key={department.id} className="border-t border-line-light">
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={ticked}
                                aria-label={t('reportWizard.scope.include', { name })}
                                onCheckedChange={() => update({ departmentIds: toggled(state.departmentIds, department.id) })}
                              />
                            </td>
                            <td className={ticked ? 'px-3 py-2' : 'px-3 py-2 text-fg-secondary'}>{name}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{department.respondentCount}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-fg-secondary">{department.headcount ?? '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </Table>
                </div>
              )
            )}
            <Note tone="info" icon={<Shield aria-hidden="true" />}>
              <span>
                {state.scope === 'chosen' && options && (
                  <b>{t('reportWizard.scope.summary', { count: state.departmentIds.length, total: options.departments.length })} </b>
                )}
                {t('reportWizard.scope.note')} {t('reportWizard.scope.floor')}
              </span>
            </Note>
          </div>
        )}

        {stepIndex === 2 && (
          <div className="flex flex-col gap-4">
            {variables.length === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{t('reportWizard.crosses.noVariables')}</p>
            ) : (
              <>
                <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    {t('reportWizard.crosses.variable')}
                    <select
                      className="h-8 rounded-md border border-line-default bg-surface-card px-2 text-base text-fg-primary"
                      value={crossRow}
                      onChange={(event) => setCrossRow(event.target.value)}
                    >
                      {variables.map((variable) => (
                        <option key={variable.field} value={variable.field}>
                          {variable.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span aria-hidden="true" className="hidden pb-1.5 text-xl text-fg-secondary sm:block">
                    ×
                  </span>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    {t('reportWizard.crosses.crossedWith')}
                    <select
                      className="h-8 rounded-md border border-line-default bg-surface-card px-2 text-base text-fg-primary"
                      value={crossColumn}
                      onChange={(event) => setCrossColumn(event.target.value)}
                    >
                      <option value="">{t('reportWizard.crosses.alone')}</option>
                      {variables
                        .filter((variable) => variable.field !== crossRow)
                        .map((variable) => (
                          <option key={variable.field} value={variable.field}>
                            {variable.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!crossRow || state.crosses.length >= maxCrosses}
                    onClick={() =>
                      update({
                        crosses: addCross(
                          state.crosses,
                          { row: crossRow, column: crossColumn && crossColumn !== crossRow ? crossColumn : null },
                          maxCrosses,
                        ),
                      })
                    }
                  >
                    {t('reportWizard.crosses.add')}
                  </Button>
                </div>
                {suggestedCrosses(variables, state.crosses).length > 0 && state.crosses.length < maxCrosses && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm text-fg-secondary">{t('reportWizard.crosses.suggested')}</span>
                    {suggestedCrosses(variables, state.crosses).map((cross) => (
                      <Button
                        key={`${cross.row}*${cross.column}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => update({ crosses: addCross(state.crosses, cross, maxCrosses) })}
                      >
                        {`${variableLabel(variables, cross.row)} × ${variableLabel(variables, cross.column ?? '')}`}
                      </Button>
                    ))}
                  </div>
                )}
                {state.crosses.length >= maxCrosses && (
                  <p className="m-0 text-sm text-fg-secondary">{t('reportWizard.crosses.limit', { max: maxCrosses })}</p>
                )}
              </>
            )}

            {state.crosses.length === 0 ? (
              <p className="m-0 text-sm text-fg-secondary">{t('reportWizard.crosses.none')}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {state.crosses.map((cross, index) => {
                  const counted = preview?.crosses[index]
                  const title = cross.column
                    ? `${variableLabel(variables, cross.row)} × ${variableLabel(variables, cross.column)}`
                    : t('reportWizard.crosses.aloneTitle', { name: variableLabel(variables, cross.row) })
                  return (
                    <li
                      key={`${cross.row}*${cross.column ?? ''}`}
                      className="flex items-center gap-3.5 rounded-lg border border-line-light px-3.5 py-3"
                      data-slot="cross-row"
                    >
                      <span className="flex min-w-0 grow flex-col">
                        <span className="font-semibold">{title}</span>
                        <span className="flex flex-wrap items-center gap-1.5 text-sm text-fg-secondary">
                          {previewBusy || !counted ? (
                            t('reportWizard.crosses.counting')
                          ) : cross.column ? (
                            <>
                              {t('reportWizard.crosses.groups', { count: counted.groups })} ·{' '}
                              <b className="text-fg-primary">{t('reportWizard.crosses.disclosed', { count: counted.disclosed })}</b>
                              {counted.protected > 0 && (
                                <>
                                  {' · '}
                                  <span className="inline-flex items-center gap-1">
                                    <Lock aria-hidden="true" className="size-3" />
                                    {counted.protected === 1
                                      ? t('reportWizard.crosses.protectedOne')
                                      : t('reportWizard.crosses.protected', { count: counted.protected })}
                                  </span>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              {t('reportWizard.crosses.groups', { count: counted.groups })} · {t('reportWizard.crosses.single')}
                            </>
                          )}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => update({ crosses: state.crosses.filter((_, at) => at !== index) })}
                      >
                        {t('reportWizard.crosses.remove')}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
            <Note icon={<Lock aria-hidden="true" />}>{t('reportWizard.crosses.note')}</Note>
          </div>
        )}

        {stepIndex === 3 && (
          <div className="flex flex-col gap-4">
            <ul className="m-0 flex list-none flex-col divide-y divide-line-light rounded-lg border border-line-light p-0">
              {SECTION_ORDER.map((section) => {
                const unavailable =
                  (section === 'comparison' && !state.compareSurveyId) || (section === 'crosses' && state.crosses.length === 0)
                const checked = state.sections.includes(section) && !unavailable
                const id = `report-section-${section}`
                return (
                  <li key={section} className="flex items-start gap-3 px-3.5 py-3">
                    <Switch
                      id={id}
                      checked={checked}
                      disabled={unavailable}
                      onCheckedChange={() => update({ sections: toggled(state.sections, section) })}
                    />
                    <label htmlFor={id} className="flex min-w-0 grow flex-col">
                      <span className="font-semibold">{t(`reportWizard.content.sections.${section}.title`)}</span>
                      <span className="text-sm text-fg-secondary">
                        {section === 'comparison' && unavailable
                          ? t('reportWizard.content.comparisonNeedsSurvey')
                          : section === 'crosses' && unavailable
                            ? t('reportWizard.content.crossesNeedCross')
                            : t(`reportWizard.content.sections.${section}.body`)}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <p className="m-0 text-sm text-fg-secondary">
              {t('reportWizard.content.scale', {
                scale: options?.scale === 'percent' ? t('reportWizard.content.scalePercent') : t('reportWizard.content.scaleMean'),
              })}
            </p>
          </div>
        )}

        {stepIndex === 4 && (
          <div className="flex flex-col gap-4">
            <dl className="m-0 grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-fg-secondary">{t('reportWizard.review.survey')}</dt>
              <dd className="m-0">
                {options?.title ?? selectedSurvey?.title ?? '—'}
                {options && ` · ${t('reportWizard.survey.responses', { count: options.completedCount })}`}
              </dd>
              <dt className="text-fg-secondary">{t('reportWizard.review.scope')}</dt>
              <dd className="m-0">
                {state.scope === 'chosen' && options
                  ? t('reportWizard.scope.summary', { count: state.departmentIds.length, total: options.departments.length })
                  : t('reportWizard.scope.all')}
              </dd>
              <dt className="text-fg-secondary">{t('reportWizard.review.crosses')}</dt>
              <dd className="m-0">
                {state.crosses.length === 0
                  ? t('reportWizard.review.none')
                  : state.crosses
                      .map((cross) =>
                        cross.column
                          ? `${variableLabel(variables, cross.row)} × ${variableLabel(variables, cross.column)}`
                          : variableLabel(variables, cross.row),
                      )
                      .join(' · ')}
              </dd>
              <dt className="text-fg-secondary">{t('reportWizard.review.sections')}</dt>
              <dd className="m-0">
                {choice.sections.map((section) => t(`reportWizard.content.sections.${section}.title`)).join(' · ')}
              </dd>
              <dt className="text-fg-secondary">{t('reportWizard.review.compare')}</dt>
              <dd className="m-0">
                {options?.comparableSurveys.find((survey) => survey.id === state.compareSurveyId)?.title ??
                  t('reportWizard.review.none')}
              </dd>
              <dt className="text-fg-secondary">{t('reportWizard.review.language')}</dt>
              <dd className="m-0">
                {state.lang === 'es' ? t('reportWizard.survey.spanish') : t('reportWizard.survey.english')} ·{' '}
                {options?.scale === 'percent' ? t('reportWizard.content.scalePercent') : t('reportWizard.content.scaleMean')}
              </dd>
              <dt className="text-fg-secondary">{t('reportWizard.review.size')}</dt>
              <dd className="m-0">
                {preview && !previewBusy ? t('reportWizard.review.pages', { count: preview.pageCount }) : t('reportWizard.aside.counting')}
              </dd>
            </dl>
            {preview && !previewBusy && (
              <Note tone="info" icon={<Shield aria-hidden="true" />}>
                {preview.protectedCells > 0
                  ? t('reportWizard.review.protectedNote', { count: preview.protectedCells })
                  : t('reportWizard.review.noProtected')}
              </Note>
            )}
            {outcome === 'done' && (
              <p className="m-0 text-sm text-accent-green-ink" role="status">
                {t('reportWizard.review.done')}
              </p>
            )}
            {outcome === 'failed' && (
              <p className="m-0 text-sm text-accent-red-ink" role="alert">
                {t('reportWizard.review.failed')}
              </p>
            )}
          </div>
        )}
      </WizardStepper>
    </div>
  )
}

/** The aside: the report's real size and its privacy count, from the preview route. */
function ReportAside({ hasSurvey, preview, busy }: { hasSurvey: boolean; preview: SurveyReportPreview | null; busy: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <section aria-labelledby="report-preview-title" className="rounded-xl border border-line-light bg-surface-card p-card">
        <h2 id="report-preview-title" className="m-0 text-base font-semibold">
          {t('reportWizard.aside.previewTitle')}
        </h2>
        <p className="m-0 mt-1 text-sm text-fg-secondary" aria-live="polite">
          {!hasSurvey
            ? t('reportWizard.aside.chooseSurvey')
            : busy || !preview
              ? t('reportWizard.aside.counting')
              : t('reportWizard.aside.pages', { count: preview.pageCount })}
        </p>
      </section>
      <section aria-labelledby="report-privacy-title" className="rounded-xl border border-line-light bg-surface-card p-card">
        <h2 id="report-privacy-title" className="m-0 text-base font-semibold">
          {t('reportWizard.aside.privacyTitle')}
        </h2>
        <dl className="m-0 mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-fg-secondary">{t('reportWizard.aside.disclosed')}</dt>
          <dd className="m-0 text-right font-semibold tabular-nums">{preview && !busy ? preview.disclosedCells : '—'}</dd>
          <dt className="text-fg-secondary">{t('reportWizard.aside.protected')}</dt>
          <dd className="m-0 inline-flex items-center justify-end gap-1 tabular-nums">
            <Lock aria-hidden="true" className="size-3" />
            {preview && !busy ? preview.protectedCells : '—'}
          </dd>
          <dt className="text-fg-secondary">{t('reportWizard.aside.verbatim')}</dt>
          <dd className="m-0 text-right">{t('reportWizard.aside.never')}</dd>
        </dl>
      </section>
    </div>
  )
}
