import { useState, type Ref } from 'react'
import { Link } from 'react-router'
import { Plus, Shield, Target, TrendingUp, X } from 'lucide-react'
import { useTranslation } from '../../../i18n'
import {
  BAND_PAINT,
  BandChip,
  BandGlyph,
  DistributionStrip,
  ProtectedCell,
  bandCellStyle,
  bandName,
  bandOf,
  bandRangeText,
  bandShortName,
  formatMetric,
  segmentsOf as bandSegmentsOf,
  SCALE_MAX,
  SCALE_MIN,
  type ResultBands,
} from '../../../components/charts'
import { Button } from '../../../components/ui'
import type { ViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay } from '../../../lib/calendarDay'
import { deltaInkOf } from './tint'
import FollowUpPlanForm from './FollowUpPlanForm'
import { lowShare, type ResultsCellDetail, type ResultsDistributionPoint } from './derive'

/** The artboard's `.label`: 10px, bold, uppercase, 0.06em, the tertiary ink. */
const LABEL = 'm-0 text-2xs font-bold uppercase tracking-label text-fg-label'

export interface ResultsCellPanelProps {
  detail: ResultsCellDetail
  /** The company's result bands, which the panel names the cell's area by. */
  bands: ResultBands
  /** Already-translated display name of a dimension key — the view's own lookup. */
  dimensionName: (key: string) => string
  /** This survey's wave code — "Q3" — which the company's strip belongs to. */
  code: string
  /** The anonymity floor, per company. */
  threshold: number
  /** The previous wave's code, for "Comparar con Q2" — `null` when there is none to compare with. */
  previousCode: string | null
  capabilities: ViewerCapabilities
  /** For raising a follow-up plan without leaving the panel. */
  baseUrl: string
  surveyId: string
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
 * no arithmetic and no request, and nothing in it is a sample. The group's line carries
 * its mean and no spread: `GET /surveys/{id}/analytics` gives a group one mean per
 * question (`SurveySegmentQuestionResult`) and never how its answers were spread, so
 * the panel says that rather than drawing a distribution no endpoint returned. The
 * company's strip is real, off the question's own `distribution`.
 */
export default function ResultsCellPanel({
  detail,
  bands,
  dimensionName,
  code,
  threshold,
  previousCode,
  capabilities,
  baseUrl,
  surveyId,
  id,
  headingRef,
  onClose,
}: ResultsCellPanelProps) {
  const { t, locale } = useTranslation()
  const [planning, setPlanning] = useState(false)
  const [createdPlan, setCreatedPlan] = useState<{ id: string; title: string } | null>(null)
  const score = (value: number) => formatMetric(value, { kind: 'number', decimals: 1 }, locale)
  const dimension = dimensionName(detail.dimensionKey)

  // "[Área crítica] menos de 3,00 · la celda más baja del mapa · una pregunta por
  // dimensión en esta encuesta" — the band named in its chip, then each clause derived,
  // joined with the artboard's separator.
  const clauses: string[] = []
  if (detail.band !== null) clauses.push(bandRangeText(detail.band, bands, t, locale))
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
            {detail.band !== null && (
              <>
                <BandChip band={detail.band} bands={bands} className="align-middle" />{' '}
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
                  <span className="text-sm font-semibold text-fg-primary">
                    {t('surveyResults.next.groupDistribution', { dimension, group: detail.rowName })}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-lg tabular-nums text-fg-primary">
                      {question.groupScore === null ? '—' : score(question.groupScore)}
                    </span>
                    {question.groupScore !== null && (
                      <BandChip band={bandOf(question.groupScore, bands)} bands={bands} short />
                    )}
                  </span>
                </div>
                {/* No strip for the group: the payload carries its mean per question and
                    never how its answers were spread, and a drawn spread would be a
                    number no endpoint returned. */}
                <p className="m-0 text-xs text-fg-label" data-testid="group-distribution-withheld">
                  {t('surveyResults.next.groupDistributionWithheld')}
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
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-lg tabular-nums text-fg-primary">{score(question.surveyScore)}</span>
                    <BandChip band={bandOf(question.surveyScore, bands)} bands={bands} short />
                  </span>
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
              <li key={other.id} data-testid={`other-${other.id}`} className="grid grid-cols-[1fr_9rem] items-center gap-2">
                <span className="text-sm text-fg-secondary">{other.name}</span>
                {other.isProtected || other.score === null || other.band === null ? (
                  <ProtectedCell
                    responses={0}
                    threshold={threshold}
                    description={`${other.name}, ${dimension}`}
                    showWord={false}
                    suppressedClassName="h-7.5 w-full"
                  >
                    {null}
                  </ProtectedCell>
                ) : (
                  <span
                    data-band={other.band}
                    className="flex h-7.5 items-center justify-center gap-1.5 overflow-hidden rounded border px-1.5"
                    style={bandCellStyle(other.band)}
                    title={bandName(other.band, bands, t)}
                  >
                    <span className="font-mono text-sm font-semibold tabular-nums">{score(other.score)}</span>
                    <span className="sr-only">{` — ${bandName(other.band, bands, t)}`}</span>
                    <span aria-hidden="true" className="inline-flex min-w-0 items-center gap-0.75 text-3xs font-semibold uppercase tracking-label">
                      <BandGlyph band={other.band} />
                      <span className="truncate">{bandShortName(other.band, bands, t)}</span>
                    </span>
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
              // Opens the form HERE, pre-scoped to this group and this dimension.
              //
              // It used to link to `/action-plans` — the LIST — so a reader who had clicked
              // Reconocimiento × Ventanilla Única arrived having lost both, and had to retype
              // the department and remember what they were acting on. The plan they wanted
              // was always "this cell"; the screen made them say so again.
              capabilities.canCreateActionPlan &&
              detail.plan === null &&
              !planning && (
                <Button variant="outline" onClick={() => { setPlanning(true); setCreatedPlan(null) }}>
                  <Plus aria-hidden="true" />
                  {t('surveyResults.next.createPlan')}
                </Button>
              )
            )}
          </div>
          {planning && (
            <FollowUpPlanForm
              baseUrl={baseUrl}
              surveyId={surveyId}
              request={{
                title: t('surveyResults.next.cellPlanTitle', {
                  group: detail.rowName,
                  dimension: dimensionName(detail.dimensionKey),
                }),
                description:
                  detail.score === null
                    ? t('surveyResults.next.cellPlanDescriptionNoScore', {
                        group: detail.rowName,
                        dimension: dimensionName(detail.dimensionKey),
                      })
                    : t('surveyResults.next.cellPlanDescription', {
                        group: detail.rowName,
                        dimension: dimensionName(detail.dimensionKey),
                        score: score(detail.score),
                      }),
                departmentId: detail.rowId,
                // The dimension travels too: a department can carry several plans, and
                // "which finding was this one for" is otherwise only in the prose.
                tags: ['seguimiento', `department:${detail.rowId}`, `dimension:${detail.dimensionKey}`],
              }}
              onCreated={(plan) => {
                setPlanning(false)
                setCreatedPlan(plan)
              }}
              onCancel={() => setPlanning(false)}
            />
          )}
          {createdPlan && (
            <p className="m-0 text-sm text-fg-primary">
              {t('surveyResults.cross.created', { title: createdPlan.title })}{' '}
              <Link className="underline" to={`/action-plans/${createdPlan.id}`}>
                {t('surveyResults.cross.viewPlan')}
              </Link>
            </p>
          )}
          {/* The answer, not a way to go looking for it.
              This used to be a button to `/surveys/climate-trends` — the whole company across
              every wave — from a panel the reader opened to ask about ONE group on ONE
              dimension. It dropped both halves of the question, and the page it landed on
              could not answer it. `previousScore` is this same cell last wave, read off the
              same `groupScores` the grid's own wave column reads. */}
          {previousCode && (
            <div className="flex flex-col gap-1">
              <p className={LABEL}>
                <TrendingUp aria-hidden="true" className="mr-1 inline size-3" />
                {t('surveyResults.next.compareWave', { wave: previousCode })}
              </p>
              {detail.previousScore === null || detail.score === null ? (
                // The previous wave withheld this group, or did not have it. Saying "sin Q3"
                // is what the grid says in the same case; a 0 would be a claim about people
                // who were never disclosed.
                <p className="m-0 text-sm text-fg-secondary">
                  {t('surveyResults.next.noPrevious', { wave: previousCode })}
                </p>
              ) : (
                <WaveSlope
                  from={detail.previousScore}
                  to={detail.score}
                  fromLabel={previousCode}
                  toLabel={code}
                  bands={bands}
                  locale={locale}
                  t={t}
                />
              )}
            </div>
          )}
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


/**
 * One wave-over-wave change for a single cell.
 *
 * Direction by arrow as well as by colour, the same choice the cross panel makes: an
 * amber or red cell behind a red digit is not a sign a colour-blind reader can read.
 */
function WaveDelta({
  from,
  to,
  locale,
  t,
}: {
  from: number
  to: number
  locale: string
  t: Translate
}) {
  // Rounded to the decimal both figures are printed at, so the arrow cannot contradict them.
  const shown = Math.round((to - from) * 10) / 10 || 0
  const text = `${shown > 0 ? '+' : ''}${formatMetric(shown, { kind: 'number', decimals: 1 }, locale)}`
  return (
    <span className={`font-mono text-xs tabular-nums ${deltaInkOf(shown, 1)}`}>
      <span aria-hidden="true">{shown < 0 ? '▼' : shown > 0 ? '▲' : '–'} </span>
      {text}
      <span className="sr-only">
        {` ${shown < 0 ? t('surveyResults.next.waveDown') : shown > 0 ? t('surveyResults.next.waveUp') : t('surveyResults.next.waveFlat')}`}
      </span>
    </span>
  )
}


/**
 * The cell's two waves on the scale they were measured on.
 *
 * ## Why a graph and not two numbers
 *
 * "Q2 2,4 → Q3 2,6" tells a reader the direction and makes them do the rest: how far 2,6 is
 * from the top, whether it crossed out of the critical area, how big 0,2 is against the range
 * actually available. Drawn on the band scale, all three are read at a glance and none of them
 * is arithmetic the reader has to perform.
 *
 * The zones are `segmentsOf(bands)` — the company's own result bands, the same three the grid
 * and the legend use — so "it moved out of the red" is a statement about this company's
 * thresholds and not about a number line.
 *
 * The line between the two dots carries the change; the dots carry where each wave landed.
 * The previous wave is hollow and the current one filled, so which is now is not a colour
 * question.
 */
function WaveSlope({
  from,
  to,
  fromLabel,
  toLabel,
  bands,
  locale,
  t,
}: {
  from: number
  to: number
  fromLabel: string
  toLabel: string
  bands: ResultBands
  locale: string
  t: Translate
}) {
  const span = SCALE_MAX - SCALE_MIN
  const at = (value: number) => ((Math.min(Math.max(value, SCALE_MIN), SCALE_MAX) - SCALE_MIN) / span) * 100
  const fromAt = at(from)
  const toAt = at(to)
  const shown = Math.round((to - from) * 10) / 10 || 0
  const left = Math.min(fromAt, toAt)
  const width = Math.abs(toAt - fromAt)
  const number = (value: number) => formatMetric(value, { kind: 'number', decimals: 1 }, locale)

  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-sm text-fg-primary">
        <span className="font-mono tabular-nums">{`${fromLabel} ${number(from)}`}</span>
        <span aria-hidden="true" className="text-fg-label">→</span>
        <span className="font-mono tabular-nums font-semibold">{`${toLabel} ${number(to)}`}</span>
        <WaveDelta from={from} to={to} locale={locale} t={t} />
      </p>
      {/* Decorative: every value it draws is printed above it, and the band each wave falls
          in is already named in the panel's own summary line. */}
      <div aria-hidden="true" className="flex flex-col gap-1">
        <div className="relative h-5 w-full overflow-hidden rounded-md">
          {bandSegmentsOf(bands).map((segment) => (
            <span
              key={segment.key}
              className="absolute inset-y-0"
              style={{
                left: `${at(segment.from)}%`,
                width: `${at(segment.to) - at(segment.from)}%`,
                // `BandScaleSegment.key` also admits 'gap', which `segmentsOf` never emits;
                // painting it neutral is cheaper than asserting it away.
                backgroundColor: segment.key === 'gap' ? 'var(--admin-hatch-ground)' : BAND_PAINT[segment.key].fill,
              }}
            />
          ))}
          {/* The move itself, drawn between the two readings. */}
          <span
            className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full"
            style={{
              left: `${left}%`,
              width: `${width}%`,
              backgroundColor: shown < 0 ? 'var(--admin-accent-red-ink)' : 'var(--admin-accent-green-ink)',
            }}
          />
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface-card"
            style={{ left: `${fromAt}%`, borderColor: 'var(--admin-font-secondary)' }}
          />
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
            style={{ left: `${toAt}%`, backgroundColor: BAND_PAINT[bandOf(to, bands)].ink }}
          />
        </div>
        <div className="flex justify-between font-mono text-2xs tabular-nums text-fg-label">
          <span>{number(SCALE_MIN)}</span>
          <span>{number(SCALE_MAX)}</span>
        </div>
      </div>
    </div>
  )
}
