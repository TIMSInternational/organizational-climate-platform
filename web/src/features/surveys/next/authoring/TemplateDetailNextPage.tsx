import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, Rows3 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { PageTopBar } from '../../../../components/layout'
import { Alert, AlertDescription, Button, Chip, ErrorState, LoadingRegion, SkeletonText } from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../../company-context'
import { useCompanyName } from '../../../../company-context/useCompanyName'
import { useTranslation, type Locale } from '../../../../i18n'
import { getSurveyTemplate, instantiateSurveyTemplate, type SurveyTemplateDetail } from '../../api/surveyTemplates'
import { requiredLocalesFor } from '../../api/surveyInvitationCopy'
import { dimensionLabel } from '../../dimensionLabel'
import { Eyebrow, Note, Panel, PanelHeading, Segmented } from '../../../shared-next/parts'
import { groupByDimension, scaleName, uniformScale } from './model'

/**
 * Detalle de plantilla, redesigned (canvas board "TemplateDetail"): the template's questions
 * grouped by the dimension they aggregate under, each with its other-language line, a
 * "Ficha" of facts and one primary "Usar plantilla".
 *
 * Read with `GET /survey-templates/{id}` once per language the template is written in, so a
 * bilingual template shows both lines as authored — a monolingual one costs one read.
 * "Usar plantilla" is the previous page's submit path (`instantiateSurveyTemplate`, which
 * needs a company for a super administrator — hence `useCompanyScope`), and then opens the
 * created draft's questions, as the board's "Al usarla" promises. The previous
 * `pages/SurveyTemplateDetailPage.tsx` stays in the tree as the wiring reference.
 */

type Load = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; byLocale: Partial<Record<Locale, SurveyTemplateDetail>>; primary: SurveyTemplateDetail }

function useTemplateDetailModel(id: string | undefined) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [state, setState] = useState<Load>({ status: 'loading' })
  const load = useCallback(async () => {
    if (!id) return
    setState({ status: 'loading' })
    try {
      const primary = await getSurveyTemplate(baseUrl, id, locale)
      const byLocale: Partial<Record<Locale, SurveyTemplateDetail>> = { [primary.resolvedLocale as Locale]: primary }
      for (const other of requiredLocalesFor(primary.language)) {
        if (!byLocale[other]) byLocale[other] = await getSurveyTemplate(baseUrl, id, other)
      }
      setState({ status: 'ready', byLocale, primary })
    } catch (error) {
      setState({ status: 'failed', message: error instanceof Error ? error.message : t('errors.generic') })
    }
  }, [baseUrl, id, locale, t])
  useEffect(() => {
    void load()
  }, [load])
  return { state, reload: load }
}

export default function TemplateDetailNextPage() {
  const { id } = useParams<{ id: string }>()
  const { t, locale } = useTranslation()
  const navigate = useNavigate()
  const caps = useViewerCapabilities()
  const scope = useCompanyScope()
  const companyName = useCompanyName()
  const { state, reload } = useTemplateDetailModel(id)
  const [first, setFirst] = useState<Locale>(locale)
  const [using, setUsing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const copy = (key: string, vars?: Record<string, string | number>) => t(`surveys.next.template.${key}`, vars)

  if (state.status === 'loading') {
    return (
      <LoadingRegion loading label={t('common.loading')}>
        <SkeletonText lines={8} />
      </LoadingRegion>
    )
  }
  if (state.status === 'failed') {
    return (
      <ErrorState
        title={t('errors.generic')}
        description={state.message}
        action={
          <Button variant="outline" onClick={() => void reload()}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }

  const { primary, byLocale } = state
  // The reader's language first, as the board orders Español · Inglés for a Spanish reader.
  const locales = (Object.keys(byLocale) as Locale[]).sort((x, y) => (x === locale ? -1 : y === locale ? 1 : 0))
  const firstLocale = byLocale[first] ? first : primary.resolvedLocale as Locale
  const secondLocale = locales.find((l) => l !== firstLocale) ?? null
  const textOf = (loc: Locale | null, questionId: string) => (loc ? byLocale[loc]?.questions.find((q) => q.id === questionId)?.text ?? null : null)
  const questions = [...primary.questions].sort((a, b) => a.order - b.order)
  const scale = uniformScale(questions)
  const scaleSource = byLocale[firstLocale] ?? primary
  const firstScale = uniformScale(scaleSource.questions)
  const n = questions.length
  const scaleChipLabel = scale ? `${scaleName(t, scale.type)} ${scale.min}–${scale.max}` : null
  const needsCompany = scope.status !== 'ready'
  const created = new Intl.DateTimeFormat(locale === 'es' ? 'es-CR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(primary.createdAt))
  const scopeLabel = primary.isGlobal ? copy('scopeGlobal') : copy('scopeCompany')

  async function use() {
    if (!id) return
    setUsing(true)
    setActionError(null)
    try {
      const survey = await instantiateSurveyTemplate(import.meta.env.VITE_API_BASE_URL as string, id, { companyId: scope.companyId }, locale)
      void navigate(`/surveys/${survey.id}/questions`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('errors.generic'))
      setUsing(false)
    }
  }

  return (
    <div>
      <PageTopBar
        breadcrumbs={[{ label: t('navigation.surveyTemplates'), href: '/surveys/templates' }, { label: primary.name }]}
        eyebrow={copy('eyebrow', { category: categoryLabel(t, primary.category) })}
        title={primary.name}
        description={copy(locales.length === 2 ? 'descriptionBoth' : 'descriptionOne', { count: n })}
        meta={
          <>
            <Chip tone="neutral" label={scopeLabel} />
            <Chip tone="neutral" label={categoryLabel(t, primary.category)} />
            <Chip tone="neutral" label={locales.map((l) => copy(`language.${l}`)).join(' · ')} />
            {scaleChipLabel && <Chip tone="neutral" label={scaleChipLabel} />}
            <span>{copy('countUsed', { count: n, used: primary.usageCount })}</span>
          </>
        }
        actions={
          caps.canAuthorSurveys ? (
            <Button type="button" variant="primary" disabled={using || needsCompany} onClick={() => void use()}>
              <ArrowRight aria-hidden="true" />
              {copy('use')}
            </Button>
          ) : null
        }
      />

      {caps.canAuthorSurveys && needsCompany && (
        <Alert variant="warning" className="mb-5">
          <AlertDescription>{scope.isSuperAdmin ? t('surveys.chooseCompanyToUseTemplate') : t('surveys.noCompanyToUseTemplate')}</AlertDescription>
        </Alert>
      )}
      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-5">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {/* The board's two columns and the Ficha / "Al usarla" stack, 16px apart (TemplateDetail.dc.html). */}
      <div data-testid="template-columns" className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <Panel aria-labelledby="template-questions">
          <PanelHeading
            id="template-questions"
            title={copy('questions')}
            count={n}
            aside={
              locales.length > 1 ? (
                <span className="flex items-center gap-2">
                  {copy('firstIn')}
                  <Segmented label={copy('firstIn')} value={firstLocale} options={locales.map((l) => ({ value: l, label: copy(`language.${l}`) }))} onChange={setFirst} />
                </span>
              ) : null
            }
          />
          <p className="mb-3 mt-0 text-sm text-fg-secondary">{locales.length > 1 ? copy('groupedBoth', { language: copy(`languageLower.${secondLocale}`) }) : copy('groupedOne')}</p>
          {scale && firstScale && (
            <div data-testid="scale-strip" className="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-surface-icon-box px-3 py-2 text-sm text-fg-tertiary">
              <span className="font-semibold text-fg-secondary">{copy('scaleIn', { count: n })}</span>
              <span>{firstScale.minLabel}</span>
              {Array.from({ length: scale.max - scale.min + 1 }, (_, i) => (
                <span key={i} className="flex size-6 items-center justify-center rounded border border-line-default bg-surface-card font-mono text-xs text-fg-secondary">
                  {scale.min + i}
                </span>
              ))}
              <span>{firstScale.maxLabel}</span>
              {scale.allRequired && <span className="ml-auto">{copy('allRequired')}</span>}
            </div>
          )}
          {groupByDimension(questions).map((group) => (
            <section key={group.key ?? 'none'} className="mb-3">
              <div className="mb-1.5 flex items-center gap-2">
                <Eyebrow className="tracking-wider">{group.key ? dimensionLabel(group.key, t) : copy('noDimension')}</Eyebrow>
                <span className="h-px flex-1 bg-line-light" />
                <span className="text-xs text-fg-tertiary">{copy(group.questions.length === 1 ? 'oneQuestion' : 'manyQuestions', { count: group.questions.length })}</span>
              </div>
              {group.questions.map((question) => (
                <div key={question.id} data-testid="template-question" className="mb-2 flex items-start gap-3 rounded-lg border border-line-default px-3 py-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-icon-box font-mono text-xs font-semibold text-fg-secondary">{questions.indexOf(question) + 1}</span>
                  <div className="min-w-0 text-base">
                    <p className="m-0 font-medium text-fg-primary">{textOf(firstLocale, question.id) ?? question.text}</p>
                    {secondLocale && <p className="m-0 text-sm text-fg-tertiary">{textOf(secondLocale, question.id)}</p>}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </Panel>

        <div data-testid="template-aside" className="flex flex-col gap-4">
          <Panel aria-labelledby="template-facts">
            <h2 id="template-facts" className="mb-3 mt-0 text-2xl">
              {copy('facts')}
            </h2>
            <dl className="m-0 grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-base">
              <dt className="text-fg-tertiary">{copy('category')}</dt>
              <dd className="m-0 text-fg-primary">{categoryLabel(t, primary.category)}</dd>
              <dt className="text-fg-tertiary">{copy('scope')}</dt>
              <dd className="m-0 flex flex-col items-start gap-1">
                <Chip tone="neutral" label={scopeLabel} />
                <span className="text-sm text-fg-tertiary">{primary.isGlobal ? copy('scopeGlobalNote') : copy('scopeCompanyNote', { company: companyName ?? t('insights.next.thisCompany') })}</span>
              </dd>
              <dt className="text-fg-tertiary">{copy('languages')}</dt>
              <dd className="m-0 flex flex-col items-start gap-1">
                <span className="flex flex-wrap gap-1.5">
                  {locales.map((l) => (
                    <Chip key={l} tone="good" icon={<Check className="size-3" />} label={copy(`language.${l}`)} />
                  ))}
                </span>
                <span className="text-sm text-fg-tertiary">{copy(locales.length === 2 ? 'allInBoth' : 'allInOne', { count: n })}</span>
              </dd>
              {scale && (
                <>
                  <dt className="text-fg-tertiary">{copy('scale')}</dt>
                  <dd className="m-0 text-fg-primary">{copy('scaleFact', { type: scaleName(t, scale.type), min: scale.min, max: scale.max, count: n })}</dd>
                </>
              )}
              <dt className="text-fg-tertiary">{copy('used')}</dt>
              <dd className="m-0 text-sm text-fg-tertiary">
                <span className="font-mono text-base text-fg-primary">{primary.usageCount}</span> {copy('times')}
              </dd>
              <dt className="text-fg-tertiary">{copy('created')}</dt>
              <dd className="m-0 font-mono text-fg-primary">{created}</dd>
            </dl>
          </Panel>
          <Panel aria-labelledby="template-using">
            <h2 id="template-using" className="mb-3 mt-0 text-2xl">
              {copy('whenUsed')}
            </h2>
            <ol className="m-0 flex list-none flex-col gap-3 p-0 text-sm text-fg-secondary">
              {[copy('step1', { company: companyName ?? t('insights.next.thisCompany'), count: n }), copy('step2'), copy('step3')].map((step, index) => (
                <li key={index} className="flex items-start gap-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-icon-box font-mono text-xs font-semibold text-fg-secondary">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </Panel>
          <Note icon={<Rows3 />}>{copy('keysNote')}</Note>
        </div>
      </div>
    </div>
  )
}

function categoryLabel(t: (key: string) => string, category: string): string {
  return ['climate', 'pulse', 'engagement', 'onboarding', 'exit'].includes(category) ? t(`surveys.next.template.categories.${category}`) : category
}
