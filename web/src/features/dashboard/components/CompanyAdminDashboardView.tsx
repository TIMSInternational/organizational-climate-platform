import { useCallback } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, CheckCircle2, ClipboardList, FileText, Gauge, Lock, Plus, Radio } from 'lucide-react'
import { getCompanyAdminDashboard, type CompanyAdminDashboard } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import {
  belowTarget,
  mapExtreme,
  measurableDepartments,
  organisationResponseRate,
  publishableDepartments,
  readDepartments,
  type DepartmentReading,
} from '../companyClimate'
import DashboardState from './DashboardState'
import DashboardSurveyTable from './DashboardSurveyTable'
import { calendarDay } from '../calendarDay'
import { acceptsResponses } from '../../surveys/surveyVocabulary'
import { useTranslation, type TranslateFn, type TranslateParams } from '../../../i18n'
import { JourneyTimeline, PageTopBar, QuickActions, type JourneyStep, type QuickAction } from '../../../components/layout'
import { ClimateMap, KpiTile } from '../../../components/charts'
import { Button, EmptyState } from '../../../components/ui'

interface CompanyAdminDashboardViewProps {
  /**
   * Sent only for a SuperAdmin, who has no tenant of their own and must name one. For a
   * CompanyAdmin this is `undefined` and the **server** decides the scope from their claim
   * — sending an id from the client would be a scope the client chose, which is the shape
   * this endpoint refuses (a CompanyAdmin naming another tenant gets a 403).
   */
  companyId?: string
}

/**
 * One company's overview — **the reference implementation of the redesign.**
 *
 * Reached by a CompanyAdmin always, and by a SuperAdmin who has picked a tenant in the
 * header switcher — see `DashboardPage`.
 *
 * ## The composition, and why it is in this order
 *
 * `PageTopBar` (eyebrow / title / one line / actions) → a four-across row of `KpiTile` →
 * the climate map → the finding that needs attention beside three quick actions → where
 * the cycle stands → the surveys still running. It descends from *what is true* to *what
 * to do about it*: a reader who stops after the map has still learned the state of the
 * organisation, which is the whole argument of the design.
 *
 * Twelve more screens copy this shape, so four conventions are worth naming:
 *
 * 1. **Every reading is `font-mono tabular-nums`; prose stays sans.** `KpiTile` and
 *    `ClimateMap` do it internally, the sub-lines below do it explicitly, and
 *    `MonoReadings` does it for the numbers interpolated INTO a translated sentence,
 *    which `t` would otherwise hand back as one flat string in the sans face.
 * 2. **A withheld cell is drawn, never dropped.** `ClimateMap` hatches a row under the
 *    anonymity floor, and `companyClimate.ts` keeps that row out of the prose as well —
 *    see its module comment for why the two have to agree.
 * 3. **Colour never speaks alone.** The finding below is red *and* says "is behind"; the
 *    clear state is green *and* says "No department is behind"; the unmeasured state is
 *    neither colour, because it is neither good news nor bad.
 * 4. **Nothing is stated that the payload cannot support.** Whether a survey is open is
 *    read off its status and never off its dates (`cycleSteps`); an all-clear is only
 *    drawn when something was actually measured (`comparable`); and a figure that does
 *    not exist is an em dash rather than a zero.
 *
 * ## What the API cannot yet supply, and what is rendered instead
 *
 * The design's KPI row opens with a climate index and its delta since Q1, and its map is
 * departments × dimensions. `GET /dashboard/company-admin` carries neither: no score, no
 * dimension, no previous period. Nothing here invents one. The map plots the one polarity
 * the payload does support — completed responses per person against the organisation's own
 * rate — and the index tile is absent rather than faked. `companyClimate.ts` documents the
 * measurement; if per-dimension scores ever land, the composition here does not change,
 * only the `dimensions` and `scores` handed to `ClimateMap`.
 *
 * The department table this page used to draw is deliberately gone. It printed
 * `completedResponseCount` for every department including the ones under the floor, which
 * is exactly the figure the map's hatch exists to withhold — the two could not both be
 * right, and the table was the one that was wrong.
 */
export default function CompanyAdminDashboardView({ companyId }: CompanyAdminDashboardViewProps) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const load = useCallback(
    () => getCompanyAdminDashboard(baseUrl, { companyId, lang: locale }),
    [baseUrl, companyId, locale],
  )
  const { data, loading, failed, error, reload } = useDashboardData(load)

  const readings = readDepartments(data?.departments ?? [])
  const measurable = measurableDepartments(readings)
  const unmeasurable = readings.length - measurable.length
  const target = organisationResponseRate(data)
  const behind = target === null ? [] : belowTarget(measurable, target)
  const worst = behind[0] ?? null
  // The evidence test for every claim this page makes about how departments compare.
  // `behind.length === 0` alone cannot tell "all of them are at or above the
  // organisation" from "not one of them could be measured", and the second must never
  // be published as the first — see `NeedsAttention`.
  const comparable = target !== null && publishableDepartments(measurable).length > 0

  const quickActions: QuickAction[] = [
    {
      id: 'new-survey',
      label: t('dashboard.newSurvey'),
      description: t('dashboard.newSurveySub'),
      href: '/surveys/new',
      icon: ClipboardList,
    },
    {
      id: 'microclimate',
      label: t('dashboard.runMicroclimate'),
      description: t('dashboard.runMicroclimateSub'),
      href: '/microclimates/new',
      icon: Radio,
    },
    {
      id: 'benchmarks',
      label: t('dashboard.compareBenchmarks'),
      description: t('dashboard.compareBenchmarksSub'),
      href: '/analytics/benchmarks',
      icon: Gauge,
    },
  ]

  return (
    <div>
      <PageTopBar
        // The tenant's name is the eyebrow and "Dashboard" is the title, which is the
        // redesign's header shape: the page is always the same page, and the thing that
        // changes between two SuperAdmin visits is which company it is about.
        eyebrow={data?.companyName ?? null}
        title={t('dashboard.title')}
        description={t('dashboard.organizationInsights')}
        actions={
          <>
            {data && (
              <Button asChild size="sm" variant="default">
                <Link to={`/admin/companies/${data.companyId}/reports`}>
                  <FileText aria-hidden="true" />
                  {t('dashboard.viewReports')}
                </Link>
              </Button>
            )}
            <Button asChild size="sm" variant="primary">
              <Link to="/surveys/new">
                <Plus aria-hidden="true" />
                {t('dashboard.newSurvey')}
              </Link>
            </Button>
          </>
        }
      />

      <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
        {data && (
          <div className="flex flex-col gap-section">
            <div className="grid grid-cols-1 gap-panel-gap sm:grid-cols-2 xl:grid-cols-4">
              {/* Not a percentage: this counts responses, not people, so three surveys can
                  put one person on the numerator three times and "150%" would read as a
                  bug rather than as a reading. Stated as a rate per 100 people, which is
                  what it is, and the sub-line gives the two raw counts behind it, each
                  with its noun. A tenant with no users at all has nothing to divide by,
                  and `organisationResponseRate` answers `null` for it; the tile draws an
                  em dash, because a zero there would claim a rate that was never
                  measured. */}
              <KpiTile
                label={t('dashboard.responsesPer100')}
                value={target}
                locale={locale}
                sub={
                  <MonoReadings
                    t={t}
                    messageKey="dashboard.responsesFromPeople"
                    params={{ completed: data.completedResponseCount, people: data.userCount }}
                  />
                }
              />
              <KpiTile
                label={t('dashboard.activeSurveys')}
                value={data.activeSurveyCount}
                locale={locale}
                sub={
                  <span>
                    <span className="font-mono tabular-nums">{data.draftSurveyCount}</span>{' '}
                    {t('dashboard.inDraft')}
                  </span>
                }
              />
              <KpiTile
                label={t('dashboard.openActionPlans')}
                value={data.openActionPlanCount}
                locale={locale}
                sub={
                  <span>
                    <span className="font-mono tabular-nums">{data.overdueActionPlanCount}</span>{' '}
                    {t('dashboard.overdueSuffix')}
                  </span>
                }
              />
              {/* `higherIsBetter={false}` because up is bad here: one more department
                  behind the organisation is not good news. It changes nothing today —
                  `KpiTile` only tones a delta, and a delta needs `previousValue`, which
                  this payload has no previous period to supply — so it is a statement of
                  the metric's polarity for whenever one arrives, not a fix for anything
                  currently rendered.

                  The count is `null`, not `0`, when nothing could be compared. Zero
                  below target is a finding; "no department has a publishable reading" is
                  the absence of one, and the two must not share a glyph. */}
              <KpiTile
                label={t('charts.belowTargetLegend')}
                value={comparable ? behind.length : null}
                higherIsBetter={false}
                locale={locale}
                sub={
                  <span>
                    {!comparable
                      ? t('dashboard.noReadingYet')
                      : worst
                        ? worst.name
                        : t('dashboard.noneBelowTarget')}
                  </span>
                }
              />
            </div>

            <section>
              <SectionHeading>{t('dashboard.responseRateByDepartment')}</SectionHeading>
              {measurable.length > 0 && target !== null ? (
                // The map and its notes sit side by side rather than stacked. Measured at
                // 1440: one dimension makes the whole figure about 450px wide (the legend,
                // not the column, sets that), so stacking left an empty band of panel beside
                // the hero — the reading looked incidental. `flex-wrap` folds them back
                // into one column under about 1000px of panel.
                <div className="flex flex-wrap items-start gap-section rounded-lg border border-line-light bg-surface-icon-box p-3">
                  <div className="min-w-0 max-w-full overflow-x-auto">
                    {/* `extremeAt` is passed rather than defaulted. The default is 10
                        points, right for a bounded 0-100 score and wrong for an
                        unbounded rate — see `mapExtreme`, which also explains why the
                        scale is set by the worst shortfall. */}
                    <ClimateMap
                      dimensions={[
                        {
                          key: 'responseRate',
                          label: t('dashboard.responsesPer100Short'),
                          fullLabel: t('dashboard.responsesPer100Full'),
                        },
                      ]}
                      rows={measurable.map(toClimateRow)}
                      target={target}
                      extremeAt={mapExtreme(measurable, target)}
                    />
                  </div>
                  {/* `min-w-64`, not `min-w-0`: with nothing stopping it the note column
                      shrank to about 100px beside the map at a 900px viewport and set the
                      Spanish sentence in an eight-line ribbon. A floor makes `flex-wrap`
                      drop it under the map instead, which is what the wrap is for. */}
                  <div className="min-w-64 max-w-prose flex-1">
                    <p className="mb-0 text-xs text-fg-secondary">
                      <MonoReadings t={t} messageKey="dashboard.mapTargetNote" params={{ target }} />
                    </p>
                    {unmeasurable > 0 && (
                      <p className="mb-0 mt-1 text-xs text-fg-tertiary">
                        {t('dashboard.departmentsWithoutMembers')}{' '}
                        <span className="font-mono tabular-nums">{unmeasurable}</span>
                      </p>
                    )}
                  </div>
                </div>
              ) : readings.length === 0 ? (
                <EmptyState
                  title={t('dashboard.noDepartmentsYet')}
                  description={t('dashboard.organizeDepartments')}
                />
              ) : (
                // Departments exist; none of them can be plotted. Telling this admin to
                // "create departments" would be advice to build what they already have,
                // so the honest sentence — the same one that runs under the map when
                // only *some* rows are unmeasurable — is what goes here instead. It used
                // to live only inside the map branch and was therefore unreachable in
                // exactly the case it describes.
                <EmptyState
                  title={t('dashboard.noDepartmentReadings')}
                  description={t('dashboard.noDepartmentReadingsBody')}
                  action={
                    unmeasurable > 0 ? (
                      <p className="mb-0 text-xs text-fg-tertiary">
                        {t('dashboard.departmentsWithoutMembers')}{' '}
                        <span className="font-mono tabular-nums">{unmeasurable}</span>
                      </p>
                    ) : undefined
                  }
                />
              )}
            </section>

            <div className="grid grid-cols-1 gap-panel-gap lg:grid-cols-2">
              <section>
                <SectionHeading>{t('dashboard.needsAttention')}</SectionHeading>
                <NeedsAttention worst={worst} target={target} comparable={comparable} />
              </section>

              <section>
                <SectionHeading>{t('dashboard.quickActions')}</SectionHeading>
                <QuickActions actions={quickActions} columns={3} />
              </section>
            </div>

            <section>
              <SectionHeading>{t('dashboard.cycleHeading')}</SectionHeading>
              <JourneyTimeline
                steps={cycleSteps(data, t, locale)}
                label={t('dashboard.cycleTimelineLabel')}
              />
            </section>

            <section>
              <SectionHeading>{t('dashboard.currentOngoingSurveys')}</SectionHeading>
              {/* Linked: this view's two roles are exactly the two `CanAdminister` admits, so
                  `/surveys/{id}` resolves for them. The department view deliberately does not
                  pass this — see the prop. */}
              <DashboardSurveyTable surveys={data.ongoingSurveys} canOpenSurvey />
            </section>
          </div>
        )}
      </DashboardState>
    </div>
  )
}

/**
 * The 13px semibold heading the redesign puts over every block.
 *
 * An `<h2>` because it sits under the page's one `<h1>` in `PageTopBar`; the size comes
 * from `text-base`, which is this theme's 13px shell default, rather than from the bare
 * `h2` rule (20px), because the redesign's section headings are quieter than its readings
 * on purpose.
 */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-inline text-base">{children}</h2>
}

/**
 * The substitution marker. U+241F is the *printable symbol for* the unit separator, a
 * character no sentence in either catalogue contains — checked against both files —
 * and one no author would reach for, which is why it is safe to split on.
 */
const READING_MARK = '␟'

/**
 * A translated sentence whose interpolated numbers are set in mono, and its prose is not.
 *
 * The thesis of the redesign is that every *reading* is `font-mono tabular-nums` and
 * every piece of prose stays in the sans face — that one rule is what makes the
 * product read as a measuring device. `KpiTile` and `ClimateMap` honour it because
 * they are handed a number and render it themselves. A sentence like "…{rate}
 * responses per 100 people, against {target} across the organisation" does not: `t`
 * returns one flat string, so the readings inside it came out in the sans face on the
 * screen the other twelve are copied from.
 *
 * Splitting on the placeholders in the *English* would not survive translation — the
 * Spanish puts them in a different order and a different sentence. So each numeric
 * value is substituted as a marker, the catalogue does the ordering, and the markers
 * are swapped back for mono spans afterwards. String params (a department name) are
 * prose and pass straight through.
 *
 * The value is stringified exactly as `t` would have (`String`, not `toLocaleString`),
 * so this changes the typeface and nothing else about what is printed.
 */
function MonoReadings({
  t,
  messageKey,
  params,
}: {
  t: TranslateFn
  messageKey: string
  params: TranslateParams
}) {
  const readings: string[] = []
  const marked: TranslateParams = {}
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'number') {
      marked[name] = `${READING_MARK}${readings.length}${READING_MARK}`
      readings.push(String(value))
    } else {
      marked[name] = value
    }
  }

  // One `<span>` and not a fragment. `KpiTile` lays its sub-line out as a flex row, so
  // a fragment put every prose piece and every reading in as its OWN flex item: measured
  // in Spanish at 1280, "262 respuestas completadas de 208 personas" broke into two
  // columns with the sentence wrapping inside the first. Wrapped, it is one inline run
  // that simply wraps as text.
  //
  // Every marker contributes exactly two elements to the split, so the readings are
  // always at the odd indices however many there are and wherever the catalogue put
  // them — including two of them side by side, which yields an empty prose piece
  // between rather than breaking the alternation.
  return (
    <span>
      {t(messageKey, marked)
        .split(READING_MARK)
        .map((piece, index) =>
          index % 2 === 1 ? (
            <span key={index} className="font-mono tabular-nums">
              {readings[Number(piece)]}
            </span>
          ) : (
            piece
          ),
        )}
    </span>
  )
}

/** One department as a `ClimateMap` row. `rate` is non-null by construction — see `measurableDepartments`. */
function toClimateRow(reading: DepartmentReading) {
  return {
    id: reading.id,
    label: reading.name,
    // The floor is decided on responses, which is what `ClimateMap` compares against its
    // own `threshold`. Passing the member count instead would hatch the wrong rows.
    responses: reading.completedResponseCount,
    scores: [reading.rate ?? 0],
  }
}

/**
 * The single most important finding, with its evidence and the two things to do about it.
 *
 * ## Three states, because there are three things that can be true
 *
 * A department is behind; no department is behind; or **nothing could be measured**.
 * The third is not a variety of the second and must not be drawn as one. When every
 * department falls under the anonymity floor the page holds no admissible evidence
 * about any of them, and a green tick reading "No department is behind" would be a
 * clean bill of health computed from nothing — the inverse of the leak the floor
 * exists to prevent, and a worse statement than the leak, because it is one an
 * administrator would act on. `comparable` is that evidence test and it is decided
 * once, beside `worst`, so this panel and the "below target" tile cannot disagree.
 *
 * The unmeasured state is deliberately toneless: a neutral chip and a lock rather
 * than green or red, because it is neither good news nor bad news. Colour still
 * never speaks alone — each of the three says in words which one it is.
 *
 * Nothing here names a suppressed department or its counts. `worst` comes from
 * `belowTarget`, which filters them out, and the unmeasured copy says only that no
 * reading may be published — never how many responses any row is short of.
 *
 * Renders the cleared state rather than nothing when no department is behind: an empty
 * panel reads as "not measured", and the whole point of the section is to say whether
 * there is something to act on.
 */
function NeedsAttention({
  worst,
  target,
  comparable,
}: {
  worst: DepartmentReading | null
  target: number | null
  comparable: boolean
}) {
  const { t } = useTranslation()
  const state = !comparable || target === null ? 'unmeasured' : worst === null ? 'clear' : 'behind'

  const CHIP = 'flex size-7 shrink-0 items-center justify-center rounded-lg'
  const chipClassName =
    state === 'behind'
      ? `${CHIP} bg-accent-red-soft text-accent-red`
      : state === 'clear'
        ? `${CHIP} bg-accent-green-soft text-accent-green`
        : `${CHIP} bg-surface-card text-fg-tertiary`

  return (
    <div className="flex gap-inline rounded-lg border border-line-light bg-surface-icon-box p-3">
      <span aria-hidden="true" className={chipClassName}>
        {state === 'behind' ? (
          <AlertTriangle className="size-icon" />
        ) : state === 'clear' ? (
          <CheckCircle2 className="size-icon" />
        ) : (
          <Lock className="size-icon" />
        )}
      </span>
      <div className="min-w-0">
        <p className="mb-0 font-semibold">
          {state === 'behind' && worst !== null
            ? t('dashboard.attentionFinding', { department: worst.name })
            : state === 'clear'
              ? t('dashboard.attentionClear')
              : t('dashboard.attentionUnmeasured')}
        </p>
        <p className="mb-0 mt-0.5 text-sm text-fg-secondary">
          {state === 'behind' && worst !== null ? (
            <MonoReadings
              t={t}
              messageKey="dashboard.attentionEvidence"
              params={{
                completed: worst.completedResponseCount,
                members: worst.memberCount,
                department: worst.name,
                rate: worst.rate ?? 0,
                target: target ?? 0,
              }}
            />
          ) : state === 'clear' ? (
            <MonoReadings
              t={t}
              messageKey="dashboard.attentionClearEvidence"
              params={{ target: target ?? 0 }}
            />
          ) : (
            t('dashboard.attentionUnmeasuredEvidence')
          )}
        </p>
        <div className="mt-2 flex flex-wrap gap-inline">
          {/* The action plan is created from the finding, so the finding is what the
              reader is looking at when they start one — and when there is no finding
              there is no plan to start from here. Offering it beside "nothing could be
              measured" would be an action plan with nothing to name as its source,
              which is the one thing the redesign's action plans may not be. Going and
              looking at the responses stays offered in every state. */}
          {state === 'behind' && (
            <Button asChild size="sm" variant="primary">
              <Link to="/action-plans">{t('actionPlans.createActionPlan')}</Link>
            </Button>
          )}
          <Button asChild size="sm" variant="default">
            <Link to="/surveys">{t('dashboard.viewResponses')}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Where the survey cycle stands.
 *
 * ## Open or closed is the status. Never the dates.
 *
 * `acceptsResponses` decides it, mirroring `SurveyStatuses.AcceptsResponses` — and the
 * whole reason that predicate exists is documented on it. Deriving it from
 * `StartDate`/`EndDate` instead put a green completed tick and the word "closed" on
 * surveys that were still `active` and still taking answers, while the ongoing-surveys
 * table three hundred pixels below called the same rows "Active". Nothing closes a
 * survey automatically, so that was the steady state on any tenant that had let a
 * deadline slip, not an edge case.
 *
 * The dates still do real work — they are the only thing that can distinguish a survey
 * already collecting from one whose window has not opened, and they say so in the
 * timestamp — but they never decide whether the survey is open.
 *
 * A survey that is open past its own close date gets a fourth timestamp of its own
 * (`timelineStillOpen`) rather than "closes 12/6/2026" in the past tense: the state is
 * still `active`, and saying so with the date attached is the reading an administrator
 * needs to go and close it.
 *
 * ## The dates are calendar days in UTC
 *
 * `startDate` and `endDate` arrive as UTC midnights standing for a calendar day, so
 * they are formatted in UTC. Read in the browser's zone they slide: measured from
 * CDT, an end date of `2026-06-12T00:00:00Z` printed as 6/11/2026 — the wrong day,
 * on the figure the reader is being asked to act on.
 */
function cycleSteps(data: CompanyAdminDashboard, t: TranslateFn, locale: string): JourneyStep[] {
  const now = Date.now()
  const steps: JourneyStep[] = [...data.ongoingSurveys]
    .sort((left, right) => Date.parse(left.startDate) - Date.parse(right.startDate))
    .map((survey) => {
      const open = acceptsResponses(survey.status)
      const opens = Date.parse(survey.startDate)
      const closes = Date.parse(survey.endDate)
      const status = !open ? 'completed' : opens > now ? 'pending' : 'active'
      const timestamp = !open
        ? t('dashboard.timelineClosed', { date: calendarDay(closes, locale) })
        : opens > now
          ? t('dashboard.timelineOpens', { date: calendarDay(opens, locale) })
          : closes < now
            ? t('dashboard.timelineStillOpen', { date: calendarDay(closes, locale) })
            : t('dashboard.timelineCloses', { date: calendarDay(closes, locale) })

      return {
        id: survey.id,
        title: survey.title ?? t('surveys.untitled'),
        description: t('dashboard.timelineResponses', { count: survey.responseCount }),
        timestamp,
        status,
      }
    })

  steps.push({
    id: 'action-plans',
    title: t('dashboard.openActionPlans'),
    description:
      data.overdueActionPlanCount > 0
        ? t('dashboard.timelineOverdue', { count: data.overdueActionPlanCount })
        : t('dashboard.timelineNoneOverdue'),
    timestamp: t('dashboard.timelineOpenCount', { count: data.openActionPlanCount }),
    status: data.openActionPlanCount > 0 ? 'active' : 'pending',
  })

  if (data.draftSurveyCount > 0) {
    steps.push({
      id: 'drafts',
      title: t('dashboard.draftsStep'),
      timestamp: t('dashboard.timelineDraftCount', { count: data.draftSurveyCount }),
      status: 'pending',
    })
  }

  return steps
}
