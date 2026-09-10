import type { Ref } from 'react'
import { Link } from 'react-router'
import { Plus, Shield, Target, TrendingUp, X } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import { DistributionStrip, ProtectedCell, formatMetric } from '../../../components/charts'
import { Button, Chip } from '../../../components/ui'
import type { ViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay } from '../../../lib/calendarDay'
import { lowShare, type ResultsCellDetail, type ResultsDistributionPoint } from './derive'
import type { ResultsSampleWave } from './model'
import { tintOf } from './tint'

/** The artboard's `.label`: 10px, bold, uppercase, 0.06em, the tertiary ink. */
const LABEL = 'm-0 text-2xs font-bold uppercase tracking-label text-fg-label'

export interface ResultsCellPanelProps {
  detail: ResultsCellDetail
  /** Already-translated display name of a dimension key — the view's own lookup. */
  dimensionName: (key: string) => string
  /** This survey's wave code — "Q3" — which the company's strip belongs to. */
  code: string
  /** The anonymity floor, per company. */
  threshold: number
  /** The group's own 1–5 distribution is a sample — no endpoint carries it — and the chip says so. */
  sample: ResultsSampleWave
  /** The previous wave's code, for "Comparar con Q2" — `null` when there is none to compare with. */
  previousCode: string | null
  capabilities: ViewerCapabilities
  /** The panel's id, for `aria-controls` on the cell that opened it. */
  id: string
  /** The heading, so the view can move focus to it when a finding opens the cell. */
  headingRef?: Ref<HTMLHeadingElement>
  onClose: () => void
}

/**
 * The opened cell — "Celda abierta" — in the artboard's three columns: the question
 * behind the cell as two distributions (the group's, the whole company's) over one
 * axis; the same dimension in the other groups, protected ones hatched; and what is
 * being done about it, with the plan that covers the group, the way to the previous
 * wave, and the open-text privacy note.
 *
 * Every number is `detail`'s, and `detail` is `cellDetail`'s: this component makes
 * no arithmetic and no request. The one sample here is the group's own answer
 * distribution (`sampleModel.ts` says why no endpoint carries it); the company's
 * is real, off the question's own `distribution`.
 */
export default function ResultsCellPanel({
  detail,
  dimensionName,
  code,
  threshold,
  sample,
  previousCode,
  capabilities,
  id,
  headingRef,
  onClose,
}: ResultsCellPanelProps) {
  const { t, locale } = useTranslation()
  const score = (value: number) => formatMetric(value, { kind: 'number', decimals: 1 }, locale)
  const dimension = dimensionName(detail.dimensionKey)

  // "1,3 bajo la meta · la celda más baja del mapa · una pregunta por dimensión en
  // esta encuesta" — each clause derived, joined with the artboard's separator.
  const clauses: string[] = []
  if (detail.shortfall !== null) {
    clauses.push(
      detail.shortfall > 0
        ? t('surveyResults.next.cellBelowTarget', { shortfall: score(detail.shortfall) })
        : detail.shortfall < 0
          ? t('surveyResults.next.cellAboveTarget', { excess: score(-detail.shortfall) })
          : t('surveyResults.next.cellOnTarget'),
    )
  }
  if (detail.isLowest) clauses.push(t('surveyResults.next.cellLowest'))
  clauses.push(
    detail.oneQuestionPerDimension
      ? t('surveyResults.next.cellOneQuestion')
      : t('surveyResults.next.cellQuestions', { count: detail.questionCount }),
  )

  const protectedOthers = detail.others.filter((other) => other.isProtected)

  return (
    <section
      id={id}
      aria-labelledby="results-next-cell"
      data-testid="cell-panel"
      className="flex flex-col gap-3.5 rounded-lg border border-l-3 border-line-default border-l-fg-primary bg-surface-card px-5 pt-4 pb-4.5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="m-0 text-2xs font-bold uppercase tracking-eyebrow text-fg-label">
            {t('surveyResults.next.cellHeading')}
          </p>
          {/* `tabIndex={-1}` so "Ver la pregunta" can move focus here: the reader
              who opened the cell from a finding lands on what it opened. */}
          <h2 id="results-next-cell" ref={headingRef} tabIndex={-1} className="mb-0 text-2xl">
            {detail.rowName} · {dimension}
          </h2>
          <p className="m-0 text-sm text-fg-secondary">
            {detail.score !== null && (
              <>
                {t('surveyResults.next.cellMean')}{' '}
                <span className="font-mono tabular-nums text-fg-primary">{score(detail.score)}</span>
                {' · '}
              </>
            )}
            {clauses.join(' · ')}
          </p>
        </div>
        <Button variant="outline" size="icon" aria-label={t('common.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </div>

      {/* The artboard's three columns from `xl`; at 1024 the question takes the full
          width and the other two sit side by side under it. */}
      <div className="grid gap-7 md:grid-cols-2 xl:grid-cols-[1.3fr_0.7fr_1fr]">
        <div className="flex min-w-0 flex-col gap-3.5 md:col-span-2 xl:col-span-1" data-testid="cell-question">
          {detail.questions.map((question) => (
            <div key={question.questionId} className="flex flex-col gap-3.5">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-fg-primary">
                    {t('surveyResults.next.groupDistribution', { dimension, group: detail.rowName })}
                    {/* The group's own distribution is the sample on this panel. */}
                    {sample.isSample && <Chip tone="warning" label={t('dashboard.next.sampleChip')} />}
                  </span>
                  <span className="font-mono text-lg tabular-nums text-fg-primary">
                    {question.groupScore === null ? '—' : score(question.groupScore)}
                  </span>
                </div>
                <DistributionStrip
                  size="compact"
                  labels="share"
                  locale={locale}
                  min={question.scaleMin}
                  max={question.scaleMax}
                  segments={segmentsOf(sample.groupDistribution, t)}
                />
                <p className="m-0 text-xs text-fg-label">
                  {t('surveyResults.next.groupDistributionSub', { low: lowShare(sample.groupDistribution) })}
                </p>
              </div>

              {/* One axis for the two strips, in the author's own anchor words. */}
              <div aria-hidden="true" className="flex justify-between gap-2 font-mono text-2xs text-fg-label">
                {axisOf(question, t).map((tick) => (
                  <span key={tick}>{tick}</span>
                ))}
              </div>

              <div className="flex flex-col gap-1.5" data-testid="company-distribution">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-fg-primary">
                    {t('surveyResults.next.companyDistribution')}
                  </span>
                  <span className="font-mono text-lg tabular-nums text-fg-primary">{score(question.surveyScore)}</span>
                </div>
                <DistributionStrip
                  size="compact"
                  labels="share"
                  locale={locale}
                  min={question.scaleMin}
                  max={question.scaleMax}
                  segments={segmentsOf(question.surveyDistribution, t)}
                />
                <p className="m-0 text-xs text-fg-label">
                  {t('surveyResults.next.companyDistributionSubWave', {
                    wave: code,
                    responses: question.surveyAnswered,
                    low: lowShare(question.surveyDistribution),
                  })}
                </p>
                {/* The question's wording, when a dimension holds more than one and
                    the heading cannot name it. */}
                {question.text && !detail.oneQuestionPerDimension && (
                  <p className="m-0 text-sm text-fg-secondary">{question.text}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <p className={LABEL}>{t('surveyResults.next.othersHeading', { dimension })}</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="others-in-dimension">
            {detail.others.map((other) => (
              <li key={other.id} data-testid={`other-${other.id}`} className="grid grid-cols-[1fr_56px] items-center gap-2">
                <span className="text-sm text-fg-secondary">{other.name}</span>
                {other.isProtected || other.score === null || other.band === null ? (
                  <ProtectedCell
                    responses={0}
                    threshold={threshold}
                    description={`${other.name}, ${dimension}`}
                    showWord={false}
                    suppressedClassName="h-6.5 w-full"
                  >
                    {null}
                  </ProtectedCell>
                ) : (
                  <span
                    className="flex h-6.5 items-center justify-center rounded font-mono text-sm tabular-nums"
                    style={tintOf(other.band)}
                  >
                    {score(other.score)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {protectedOthers.length > 0 && (
            <p className="m-0 text-xs text-fg-label">
              {t('surveyResults.next.othersProtected', {
                groups: protectedOthers.map((other) => other.name).join(', '),
                floor: threshold,
              })}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2.5" data-testid="cell-doing">
          <p className={LABEL}>{t('surveyResults.next.doingHeading')}</p>
          {detail.plan === undefined ? (
            <p className="m-0 text-sm text-fg-secondary">{t('surveyResults.next.plansUnavailable')}</p>
          ) : detail.plan === null ? (
            <p className="m-0 text-sm text-fg-secondary">{t('surveyResults.next.doingNone')}</p>
          ) : (
            <p className="m-0 text-sm text-fg-secondary">
              {t('surveyResults.next.doingPlanLead')}{' '}
              <strong className="font-semibold text-fg-primary">{detail.plan.name}</strong>
              {' · '}
              {t('surveyResults.next.doingPlanDue', { date: calendarDay(Date.parse(detail.plan.dueAt), locale) })}
              {detail.plan.status === 'not_started' && ` · ${t('surveyResults.next.planNoProgress')}`}.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {detail.plan ? (
              // Reading a plan is `CanAccessCompany`, the whole-company viewer — the
              // one this page admits (`SurveyResultsNextPage.tsx`).
              <Button variant="outline" asChild>
                <Link to={`/action-plans/${detail.plan.id}`}>
                  <Target aria-hidden="true" />
                  {t('surveyResults.next.openPlan')}
                </Link>
              </Button>
            ) : (
              // `/action-plans`, not `/action-plans/new`: there is no such route
              // (`router.tsx` mounts the list and `:id`, and `new` would be read as
              // a plan id). The list is where "new action plan" lives.
              capabilities.canCreateActionPlan &&
              detail.plan === null && (
                <Button variant="outline" asChild>
                  <Link to="/action-plans">
                    <Plus aria-hidden="true" />
                    {t('surveyResults.next.createPlan')}
                  </Link>
                </Button>
              )
            )}
            {previousCode && (
              <Button variant="outline" asChild>
                <Link to="/surveys/climate-trends">
                  <TrendingUp aria-hidden="true" />
                  {t('surveyResults.next.compareWave', { wave: previousCode })}
                </Link>
              </Button>
            )}
          </div>
          <p className="m-0 flex items-start gap-2.5 rounded-md bg-surface-icon-box px-3.5 py-3 text-sm text-fg-secondary">
            <Shield aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>{t('surveyResults.next.openTextNote', { group: detail.rowName, floor: threshold })}</span>
          </p>
        </div>
      </div>
    </section>
  )
}

type Translate = (key: string, params?: Record<string, string | number>) => string

/** A 1–5 distribution as strip segments; the % is both the width and the label. */
function segmentsOf(points: readonly ResultsDistributionPoint[], t: Translate) {
  return points.map((point) => ({
    key: String(point.position),
    position: point.position,
    count: point.percentage,
    label: t('surveyResults.next.stripSegment', { position: point.position, percent: Math.round(point.percentage) }),
  }))
}

/** "1 · Muy en desacuerdo", "2", "3", "4", "5 · Muy de acuerdo" — the author's anchor words on the ends. */
function axisOf(
  question: { scaleMin: number; scaleMax: number; scaleLabelMin: string | null; scaleLabelMax: string | null },
  t: Translate,
): string[] {
  const ticks: string[] = []
  for (let position = question.scaleMin; position <= question.scaleMax; position += 1) {
    if (position === question.scaleMin && question.scaleLabelMin) {
      ticks.push(t('surveyResults.next.scaleEnd', { position, label: question.scaleLabelMin }))
    } else if (position === question.scaleMax && question.scaleLabelMax) {
      ticks.push(t('surveyResults.next.scaleEnd', { position, label: question.scaleLabelMax }))
    } else {
      ticks.push(String(position))
    }
  }
  return ticks
}
