import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, EyeOff, Link2Off, ShieldCheck } from 'lucide-react'
import { useParams } from 'react-router'
import { LanguageSwitcher, useTranslation } from '../../../../i18n'
import { BrandLockup, ThemeSwitcher } from '../../../../components/layout'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Chip,
  SkeletonText,
  SkipLink,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui'
import { ProtectedCell, formatMetric } from '../../../../components/charts'
import ResultsSuppressionNotice from '../../../surveys/components/ResultsSuppressionNotice'
import { dimensionLabel } from '../../../surveys/dimensionLabel'
import type { SurveyQuestionResult } from '../../../surveys/api/surveyResults'
import { calendarDay } from '../../../../lib/calendarDay'
import { applyNoIndex } from '../../../../lib/noIndex'
import { getSharedReport, type SharedReport } from '../../api/sharedReports'
import type { ReportAIInsight, ReportBenchmarkComparison } from '../../reportDocument'
import {
  CLIMATE_TARGET,
  viewOf,
  type SharedReportView,
  type SharedSection,
} from './derive'
import {
  ClimateMapGrid,
  ClimateMapLegend,
  PrivacyNote,
  ReadingCard,
  ReportCard,
  ScaleStrip,
} from './parts'

const K = 'sharedReport.next'
/** The 1-to-5 axis over the scale strip, drawn once for the whole column. */
const SCALE_TICKS = [1, 2, 3, 4, 5]
/**
 * The canvas's column heading — the artboard's `.label`: 10px, bold, uppercase, on the
 * tertiary ink, over a hairline. The `TableHead` primitive is a 13px sentence-case label
 * and every artboard-matched screen in the redesign overrides it the same way
 * (`ProfileNextPage`, `PrivacyNextPage`, `NotificationPreferencesNextPage`), so this is
 * the fourth copy of a shared decision rather than a new one. Caught in the PNG: the
 * primitive's heading read a full weight heavier than the artboard's.
 */
const TH =
  'border-b border-line-default bg-transparent px-3 pb-2 pt-1 text-left text-2xs font-bold uppercase tracking-label whitespace-nowrap text-fg-tertiary'

/**
 * `/shared/reports/:token` — the SharedReport and SharedReportUnavailable artboards
 * (10 Sep), which replaced `SharedReportPage` on this route. The old page stays in the
 * tree, unrouted, as the wiring reference.
 *
 * This is the **most exposed surface in the product**: unauthenticated by design,
 * addressed by a link anybody can forward, serving a company's climate data to whoever
 * holds the URL. Most of what follows is about what it does *not* do, and every one of
 * those decisions is inherited deliberately from the page it replaces rather than
 * re-litigated during a redesign.
 *
 * ## Where the anonymity floor is applied for this route
 *
 * **On the server, at read time.** `SurveyAggregation.cs:604` replaces a sub-floor
 * department with `(RespondentCount: 0, ParticipationRate: null, IsSuppressed: true,
 * Questions: [])` and `SurveyAggregation.cs:677` does the same for a demographic group,
 * before `ReportGeneration` stores a byte. `PublicReportProjection` then withholds the
 * sub-floor *headcount* (`ReportSurveySection.SuppressedRespondentCount` and its
 * breakdown twin) from the public payload outright, so the number the floor exists to
 * hide is not on the wire at all.
 *
 * The client re-applies the same refusal twice more, and neither is the floor: they are
 * statements of it at the layers a reader of this code can check. `reportDocument.ts`
 * (`departmentOf`, `segmentOf`, `sectionOf`) zeroes and empties a row that arrives
 * suppressed and still carrying data, and `derive.ts` refuses to read a suppressed
 * group's scores or count at all. So a generator regression, a hand-edited column, or a
 * document written by something that is not this server cannot put a sub-floor figure on
 * this page through any of the three.
 *
 * ## One outcome for every failure
 *
 * Expired, revoked and invalid must be indistinguishable — telling them apart turns a
 * share link into an oracle that says which guesses were once real. `getSharedReport`
 * rejects with `SharedReportUnavailableError`, which carries no status, no reason code
 * and no server message, so there is nothing here to branch on. The SharedReportUnavailable
 * artboard draws exactly one state and says so to the reader in as many words.
 *
 * ## The token is resolved exactly once per visit
 *
 * A read of a shared report is an audited event (#143); a page that re-resolved on every
 * language switch would file one reader as several. The locale is captured at mount and
 * the effect does not depend on it.
 *
 * ## What is not on this page
 *
 * No navigation, no account, no company switcher, no bell, no link into the app at all.
 * The header carries the wordmark and the two pickers — the same three things
 * `RespondShell` carries — and nothing else. It is not `RespondShell` itself because that
 * shell caps its column at `max-w-field` (32rem) for a phone-shaped respond form, and
 * this artboard is a 1120px document; the lockup is imported from it rather than redrawn.
 */
export default function SharedReportNextPage() {
  const { token } = useParams<{ token: string }>()
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const [state, setState] = useState<SharedReportState>({ status: 'loading' })

  // The locale as of the first render, held so the resolve effect can send it without
  // depending on it. One visit is one access-log entry.
  const requestLocale = useRef(locale)

  // `noindex` for as long as this page is mounted, and removed after: a router transition
  // does not reload the document, so a tag left behind would apply to every page rendered
  // next in this tab.
  useEffect(() => applyNoIndex(), [])

  useEffect(() => {
    if (!token) return

    let cancelled = false
    setState({ status: 'loading' })

    getSharedReport(baseUrl, token, { lang: requestLocale.current })
      .then((report) => {
        if (!cancelled) setState({ status: 'ready', report })
      })
      .catch(() => {
        // No argument, and nothing read off the rejection. Every cause — dead token,
        // revoked link, rate limit, 5xx, offline — lands here identically.
        if (!cancelled) setState({ status: 'unavailable' })
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, token])

  return (
    <div className="flex min-h-dvh flex-col bg-surface-outer">
      <SkipLink href="#report">{t('sharedReport.skipToReport')}</SkipLink>

      <header className="flex w-full flex-wrap items-center justify-between gap-inline px-4 py-3.5">
        <BrandLockup size="compact" />
        <span className="flex flex-wrap items-center gap-1.5">
          <LanguageSwitcher variant="chip" />
          <ThemeSwitcher variant="chip" />
        </span>
      </header>

      <main
        id="report"
        className="mx-auto flex w-full max-w-[70rem] flex-1 flex-col gap-6 px-4 pb-10 pt-2"
      >
        {state.status === 'loading' && (
          <div className="pt-6">
            <SkeletonText lines={6} />
          </div>
        )}
        {state.status === 'unavailable' && <Unavailable />}
        {state.status === 'ready' && <ReportBody report={state.report} />}
      </main>
    </div>
  )
}

type SharedReportState =
  | { status: 'loading' }
  | { status: 'ready'; report: SharedReport }
  | { status: 'unavailable' }

/**
 * The SharedReportUnavailable artboard: one card, one sentence, and the reason it is one
 * sentence.
 *
 * There is deliberately no retry, no "back to sign in" and no support link. A reader who
 * followed a dead share link has no account to return to and nothing to retry — the token
 * is the credential and it did not work — and a link into the app from here would be the
 * one thing this page is built not to have.
 */
function Unavailable() {
  const { t } = useTranslation()
  return (
    <div className="flex justify-center px-2 pb-8 pt-16">
      <div
        role="alert"
        className="flex w-full max-w-[32.5rem] flex-col gap-5 rounded-xl border border-line-default bg-surface-card px-7 pb-6 pt-7 shadow-sm"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-9 items-center justify-center rounded-lg bg-accent-amber-soft text-accent-amber-ink [&_svg]:size-4"
        >
          <Link2Off />
        </span>
        <div className="flex flex-col gap-2">
          <span className="text-2xs font-bold uppercase tracking-eyebrow text-fg-tertiary">
            {t('sharedReport.eyebrow')}
          </span>
          <h1 className="m-0">{t('sharedReport.unavailableTitle')}</h1>
          <p className="m-0 text-base text-fg-secondary">{t('sharedReport.unavailableBody')}</p>
        </div>
        <p className="m-0 text-xs leading-snug text-fg-tertiary">{t(`${K}.unavailableNote`)}</p>
      </div>
    </div>
  )
}

function ReportBody({ report }: { report: SharedReport }) {
  const { t, locale } = useTranslation()
  const view: SharedReportView | null = useMemo(
    () => (report.document === null ? null : viewOf(report.document, report.generatedAt)),
    [report.document, report.generatedAt],
  )

  return (
    <>
      <header className="grid gap-1.5 border-b border-line-light pb-4 pt-2">
        <span className="text-2xs font-bold uppercase tracking-eyebrow text-fg-tertiary">
          {t(`${K}.eyebrow`)}
        </span>
        <h1 className="m-0">{report.title || t('sharedReport.untitledReport')}</h1>
        {report.description !== null && report.description !== '' && (
          <p className="m-0 max-w-prose text-base text-fg-secondary">{report.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
          {report.generatedAt !== null && (
            <Chip
              icon={<CalendarDays />}
              // `calendarDay` renders the day in UTC, so a reader west of UTC is not
              // told the report was generated a day early.
              label={t(`${K}.chipGenerated`, {
                date: calendarDay(Date.parse(report.generatedAt), locale),
              })}
            />
          )}
          {view !== null && (
            <>
              <Chip tone="good" icon={<ShieldCheck />} label={t(`${K}.chipFloor`, { floor: view.floor })} />
              <Chip
                icon={<EyeOff />}
                label={view.hasOpenText ? t(`${K}.chipOpenText`) : t(`${K}.chipNoOpenText`)}
              />
            </>
          )}
        </div>
      </header>

      {view === null ? (
        <p className="m-0 max-w-prose text-base text-fg-secondary">{t('sharedReport.noDocument')}</p>
      ) : (
        <>
          {/* The generator's own note is server-authored English naming the sections it
              has not built yet, so it is never printed verbatim to a reader who may not
              read English. Its presence is the fact worth passing on. */}
          {report.document !== null && report.document.generationNote.trim() !== '' && (
            <Alert>
              <AlertTitle>{t('sharedReport.incompleteTitle')}</AlertTitle>
              <AlertDescription>{t('sharedReport.incompleteBody')}</AlertDescription>
            </Alert>
          )}

          {view.sections.length === 0 ? (
            <p className="m-0 max-w-prose text-base text-fg-secondary">
              {t('sharedReport.noSurveys')}
            </p>
          ) : (
            view.sections.map((section) => (
              <SurveyBlock
                key={section.surveyId}
                section={section}
                named={view.sections.length > 1}
              />
            ))
          )}

          {report.document !== null && report.document.benchmarks.length > 0 && (
            <ReportCard id="shared-report-benchmarks" heading={t('sharedReport.benchmarksHeading')}>
              <div className="flex flex-col gap-5">
                {report.document.benchmarks.map((benchmark) => (
                  <BenchmarkBlock key={benchmark.benchmarkId} benchmark={benchmark} />
                ))}
              </div>
            </ReportCard>
          )}

          {report.document !== null && report.document.aiInsights.length > 0 && (
            <ReportCard id="shared-report-insights" heading={t('sharedReport.insightsHeading')}>
              <div className="flex flex-col gap-4">
                {report.document.aiInsights.map((insight) => (
                  <InsightBlock key={insight.id} insight={insight} />
                ))}
              </div>
            </ReportCard>
          )}

          <PrivacyNotes floor={view.floor} hasOpenText={view.hasOpenText} />
        </>
      )}
    </>
  )
}

/** One survey: its readings, its climate, and everything the document carries under it. */
function SurveyBlock({ section, named }: { section: SharedSection; named: boolean }) {
  const { t, locale } = useTranslation()
  const headingId = `shared-report-survey-${section.surveyId}`
  const title = section.title ?? t('surveyResults.untitled')

  return (
    <section
      className="flex min-w-0 flex-col gap-4"
      aria-labelledby={named ? headingId : undefined}
      aria-label={named ? undefined : title}
    >
      {named && (
        <h2 id={headingId} className="m-0">
          {title}
        </h2>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ReadingCard
          label={t(`${K}.responsesLabel`)}
          value={section.responses.toLocaleString(locale)}
          unit={t(`${K}.responsesUnit`, { completed: section.completed.toLocaleString(locale) })}
          note={t(`${K}.responsesNote`, {
            percent: formatMetric(section.completionRate, { kind: 'percentage' }, locale),
          })}
        />
        {section.participation.kind === 'rate' ? (
          <ReadingCard
            label={t(`${K}.participationLabel`)}
            value={formatMetric(section.participation.rate, { kind: 'percentage' }, locale)}
            note={t(`${K}.participationNote`, {
              responses: section.responses.toLocaleString(locale),
              invited: section.participation.invited.toLocaleString(locale),
            })}
          />
        ) : (
          // Never `0 %`. The survey had no invitation list, so there is no denominator —
          // and a zero here would tell a board member nobody answered.
          <ReadingCard
            label={t(`${K}.participationLabel`)}
            value={t(`${K}.participationNone`)}
            numeric={false}
            note={t(`${K}.participationNoneNote`)}
          />
        )}
        <ReadingCard
          label={t(`${K}.groupsLabel`)}
          value={section.groups.readable.toLocaleString(locale)}
          unit={t(`${K}.groupsUnit`, { total: section.groups.total.toLocaleString(locale) })}
          note={groupsNote(section, t, locale)}
        />
      </div>

      {/* Which language the *authored* text below is in, and only when it differs from
          the language this reader is reading the page in — which is the only case the
          sentence tells them anything they cannot see. */}
      {section.resolvedLocale !== '' && section.resolvedLocale !== locale && (
        <p className="m-0 max-w-prose text-xs text-fg-tertiary">
          {t('sharedReport.contentLanguage', {
            language: contentLanguageName(t, section.resolvedLocale),
          })}
        </p>
      )}

      {section.suppressed ? (
        <ReportCard id={`${headingId}-dimensions`} heading={t(`${K}.dimensionsHeading`)}>
          <ResultsSuppressionNotice
            reason={section.suppressionReason}
            minimumGroupSize={section.floor}
          />
        </ReportCard>
      ) : (
        <>
          {section.dimensions.length > 0 && (
            <DimensionsCard section={section} headingId={`${headingId}-dimensions`} />
          )}
          {section.maps.map((map, index) => (
            <ReportCard
              key={map.field}
              id={`${headingId}-map-${index}`}
              heading={
                section.maps.length > 1
                  ? t(`${K}.mapHeadingField`, { field: map.field })
                  : t('surveyResults.next.mapHeading')
              }
              meta={t(`${K}.mapSub`, {
                target: formatMetric(CLIMATE_TARGET, { kind: 'number', decimals: 1 }, locale),
              })}
            >
              <ClimateMapGrid
                map={map}
                floor={section.floor}
                target={CLIMATE_TARGET}
                caption={t(`${K}.mapCaption`, { field: map.field, floor: section.floor })}
                groupHeading={t('surveyResults.next.groupHeading')}
              />
              <ClimateMapLegend floor={section.floor} />
              {map.withheldCount > 0 && (
                <p className="m-0 max-w-prose text-xs text-fg-tertiary">
                  {t('sharedReport.groupsWithheld', {
                    count: map.withheldCount,
                    minimum: section.floor,
                  })}
                </p>
              )}
              {map.unsegmented > 0 && (
                <p className="m-0 max-w-prose text-xs text-fg-tertiary">
                  {t(`${K}.mapUnsegmented`, { count: map.unsegmented, field: map.field })}
                </p>
              )}
            </ReportCard>
          ))}
        </>
      )}

      {section.departments.length > 0 && (
        <DepartmentsCard section={section} headingId={`${headingId}-departments`} />
      )}

      {section.questions.length > 0 && (
        <ReportCard id={`${headingId}-questions`} heading={t('sharedReport.questionsHeading')}>
          <div className="flex flex-col gap-6">
            {section.questions.map((question) => (
              <QuestionBlock key={question.questionId} question={question} />
            ))}
          </div>
        </ReportCard>
      )}
    </section>
  )
}

/** The artboard's "Clima por dimensión": the figure, the scale, and the reading in words. */
function DimensionsCard({ section, headingId }: { section: SharedSection; headingId: string }) {
  const { t, locale } = useTranslation()
  const target = formatMetric(CLIMATE_TARGET, { kind: 'number', decimals: 1 }, locale)

  return (
    <ReportCard
      id={headingId}
      heading={t(`${K}.dimensionsHeading`)}
      meta={
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block w-6 border-t border-dashed border-line-default"
          />
          {t(`${K}.targetMeta`, { target })}
        </span>
      }
    >
      <Table>
        <TableCaption className="text-left">{t(`${K}.dimensionsCaption`)}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className={TH}>{t('sharedReport.dimension')}</TableHead>
            <TableHead className={TH}>{t('sharedReport.averageScore')}</TableHead>
            <TableHead className={TH}>
              <span className="sr-only">{t(`${K}.scaleHeader`)}</span>
              <span aria-hidden="true" className="flex w-50 justify-between font-mono text-2xs font-normal text-fg-tertiary">
                {SCALE_TICKS.map((tick) => (
                  <span key={tick}>{tick.toLocaleString(locale)}</span>
                ))}
              </span>
            </TableHead>
            <TableHead className={TH}>{t(`${K}.readingHeader`)}</TableHead>
            <TableHead className={TH}>{t('sharedReport.questionCount')}</TableHead>
            <TableHead className={TH}>{t('sharedReport.answeredCount')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {section.dimensions.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="font-medium text-fg-primary">
                {dimensionLabel(row.key, t)}
              </TableCell>
              <TableCell className="font-mono text-base tabular-nums">
                {row.average === null
                  ? t('surveyResults.notApplicable')
                  : formatMetric(row.average, { kind: 'number', decimals: 1 }, locale)}
              </TableCell>
              <TableCell>
                {row.average !== null && row.band !== null && (
                  <ScaleStrip value={row.average} target={CLIMATE_TARGET} band={row.band} />
                )}
              </TableCell>
              <TableCell className="text-fg-secondary">
                {row.offScale ? (
                  // A figure that is not on the 1-to-5 scale the target belongs to keeps
                  // its number and says so, rather than being judged against a target it
                  // was never measured against. `derive.ts` `SCALE_MIN` has the argument.
                  t(`${K}.readingOffScale`)
                ) : row.band === null ? (
                  t('surveyResults.notApplicable')
                ) : row.band === 'far-below' || row.band === 'below' ? (
                  // The one case the artboard paints: a chip, because "bajo la meta" is
                  // the row a reader is meant to stop at. The word is there either way —
                  // colour never carries it alone.
                  <Chip tone="critical" label={t('surveyResults.next.legendBelow')} />
                ) : (
                  <span className="text-fg-secondary">
                    {row.band === 'on'
                      ? t('surveyResults.next.legendOn')
                      : t('surveyResults.next.legendAbove')}
                  </span>
                )}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {row.questionCount.toLocaleString(locale)}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {row.answeredCount.toLocaleString(locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ReportCard>
  )
}

/**
 * Participation by department.
 *
 * A withheld department keeps its row and its name, and its two numeric columns collapse
 * into one hatched `ProtectedCell`. It does not disappear: a row that vanished would let
 * a reader work out which department is missing from a list they can see elsewhere. And
 * it prints no figure — `respondentCount` is 0 on a withheld row because the server
 * zeroed it, and printing that zero would claim nobody in the department answered.
 */
function DepartmentsCard({ section, headingId }: { section: SharedSection; headingId: string }) {
  const { t, locale } = useTranslation()

  return (
    <ReportCard id={headingId} heading={t(`${K}.departmentsHeading`)}>
      <Table>
        <TableCaption className="text-left">{t('sharedReport.departmentsCaption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className={TH}>{t('surveyResults.dimensionDepartment')}</TableHead>
            <TableHead className={TH}>{t('surveyResults.respondents')}</TableHead>
            <TableHead className={TH}>{t('surveyResults.participationRate')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {section.departments.map((department) => (
            <TableRow key={department.departmentId}>
              <TableCell>{department.name ?? t('surveyResults.unsegmented')}</TableCell>
              {department.isSuppressed ? (
                <TableCell colSpan={2}>
                  <span className="flex flex-wrap items-center gap-2">
                    <ProtectedCell
                      // 0, never `department.respondentCount`: the server zeroed it and
                      // the parser zeroed it again; the withheld figure travels no
                      // further than it must.
                      responses={0}
                      threshold={section.floor}
                      description={department.name ?? t('surveyResults.unsegmented')}
                      suppressedClassName="h-[18px] w-7"
                    >
                      {null}
                    </ProtectedCell>
                  </span>
                </TableCell>
              ) : (
                <>
                  <TableCell className="font-mono tabular-nums">
                    {department.respondentCount.toLocaleString(locale)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {department.participationRate === null
                      ? t('surveyResults.notApplicable')
                      : formatMetric(department.participationRate, { kind: 'percentage' }, locale)}
                  </TableCell>
                </>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {section.withheldDepartments > 0 && (
        <p className="m-0 max-w-prose text-xs text-fg-tertiary">
          {t('sharedReport.departmentsWithheld', {
            count: section.withheldDepartments,
            minimum: section.floor,
          })}
        </p>
      )}
    </ReportCard>
  )
}

/**
 * One question: how its answers were spread, or which words were used in them.
 *
 * The word list is a **frequency map** and this renderer cannot make it anything else.
 * `reportDocument.ts` copies only `{ language, word, count, responseCount }` per entry
 * and drops any entry that is not a single token, so there is no sentence in the parsed
 * document to print. `suppressedWordCount` is stated whenever it is non-zero, because a
 * list quietly shortened reads as the complete set of what people said.
 */
function QuestionBlock({ question }: { question: SurveyQuestionResult }) {
  const { t, locale } = useTranslation()
  const heading = question.text ?? t('surveyResults.untranslatedQuestion')
  const hasWords = question.words.length > 0 || question.suppressedWordCount > 0
  const isRanking = question.distribution.some((bucket) => bucket.averageRank !== null)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="m-0 text-base font-semibold leading-normal text-fg-primary">{heading}</h3>
      <p className="m-0 text-xs text-fg-tertiary">
        {t('surveyResults.answeredCount', { count: question.answeredCount })}
      </p>

      {question.distribution.length > 0 && (
        <Table className="text-sm">
          <TableCaption className="text-left">
            {t('surveyResults.distributionOf', { question: heading })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className={TH}>{t('surveyResults.csvOptionLabel')}</TableHead>
              <TableHead className={TH}>{t('surveyResults.kpiResponses')}</TableHead>
              <TableHead className={TH}>{t('sharedReport.share')}</TableHead>
              {isRanking && <TableHead className={TH}>{t('surveyResults.averagePosition')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {question.distribution.map((bucket) => (
              <TableRow key={bucket.value}>
                <TableCell>{bucket.label ?? bucket.value}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {bucket.count.toLocaleString(locale)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {formatMetric(bucket.percentage, { kind: 'percentage' }, locale)}
                </TableCell>
                {isRanking && (
                  <TableCell className="font-mono tabular-nums">
                    {bucket.averageRank === null
                      ? t('surveyResults.notApplicable')
                      : bucket.averageRank.toLocaleString(locale, { maximumFractionDigits: 2 })}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {hasWords && (
        <>
          {question.words.length > 0 ? (
            <Table className="text-sm">
              <TableCaption className="text-left">{t('surveyResults.wordsIn', { question: heading })}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead className={TH}>{t('sharedReport.word')}</TableHead>
                  <TableHead className={TH}>{t('sharedReport.wordLanguage')}</TableHead>
                  <TableHead className={TH}>{t('sharedReport.wordMentions')}</TableHead>
                  <TableHead className={TH}>{t('sharedReport.wordAnswers')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {question.words.map((word) => (
                  <TableRow key={`${word.language}:${word.word}`}>
                    <TableCell>{word.word}</TableCell>
                    <TableCell>{contentLanguageName(t, word.language)}</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {word.count.toLocaleString(locale)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {word.responseCount.toLocaleString(locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="m-0 max-w-prose text-sm text-fg-secondary">{t('sharedReport.noWords')}</p>
          )}
          <p className="m-0 max-w-prose text-xs text-fg-tertiary">
            {t('sharedReport.wordsFrequencyOnly')}
          </p>
          {question.suppressedWordCount > 0 && (
            <p className="m-0 max-w-prose text-xs text-fg-tertiary">
              {t('surveyResults.wordsWithheld', { count: question.suppressedWordCount })}
            </p>
          )}
        </>
      )}

      {question.distribution.length === 0 && !hasWords && (
        <p className="m-0 max-w-prose text-sm text-fg-secondary">
          {t('sharedReport.noDistribution')}
        </p>
      )}
    </div>
  )
}

/** One benchmark, read against its own prior period. No row ids, no tenant GUID. */
function BenchmarkBlock({ benchmark }: { benchmark: ReportBenchmarkComparison }) {
  const { t, locale } = useTranslation()
  const prior = benchmark.priorPeriod
  const number = (value: number) => formatMetric(value, { kind: 'number', decimals: 1 }, locale)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="m-0 text-base font-semibold text-fg-primary">{benchmark.name}</h3>
        <span className="text-xs text-fg-tertiary">
          {t('sharedReport.benchmarkCategory', { category: benchmark.category })}
        </span>
        {benchmark.isGlobal && <Chip label={t('sharedReport.benchmarkGlobal')} />}
      </div>

      {prior === null ? (
        <>
          <Table className="text-sm">
            <TableCaption className="text-left">
              {t('sharedReport.benchmarkReadingsCaption', { benchmark: benchmark.name })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className={TH}>{t('sharedReport.metric')}</TableHead>
                <TableHead className={TH}>{t('sharedReport.averageScore')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {benchmark.metrics.map((metric) => (
                <TableRow key={metric.id}>
                  <TableCell>{metric.metricName}</TableCell>
                  <TableCell className="font-mono tabular-nums">{number(metric.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="m-0 max-w-prose text-xs text-fg-tertiary">
            {priorPeriodSentence(benchmark.priorPeriodStatus, t)}
          </p>
        </>
      ) : (
        <>
          <Table className="text-sm">
            <TableCaption className="text-left">
              {t('sharedReport.benchmarkCaption', { benchmark: benchmark.name })}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className={TH}>{t('sharedReport.metric')}</TableHead>
                <TableHead className={TH}>{t('sharedReport.averageScore')}</TableHead>
                <TableHead className={TH}>{t('sharedReport.priorValue')}</TableHead>
                <TableHead className={TH}>{t('sharedReport.delta')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prior.metrics.map((metric) => (
                <TableRow key={metric.metricName}>
                  <TableCell>{metric.metricName}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {metric.value === null ? t('sharedReport.notRecorded') : number(metric.value)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {metric.priorValue === null
                      ? t('sharedReport.notRecorded')
                      : number(metric.priorValue)}
                  </TableCell>
                  {/* Carried, never recomputed from the two columns beside it: the
                      server withholds this when the units differ, and a subtraction
                      done here would print the confidently wrong number #89 avoids.
                      The refusal is a sentence, so the cell drops the mono/tabular
                      rule that belongs to a figure — set in mono it rendered as a
                      typewritten paragraph the width of the card. Caught in the PNG. */}
                  {metric.delta === null ? (
                    <TableCell className="text-fg-secondary">
                      {t('sharedReport.unitsDiffer', {
                        unit: metric.unit ?? t('sharedReport.notRecorded'),
                        priorUnit: metric.priorUnit ?? t('sharedReport.notRecorded'),
                      })}
                    </TableCell>
                  ) : (
                    <TableCell className="font-mono tabular-nums">{number(metric.delta)}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="m-0 max-w-prose text-xs text-fg-tertiary">
            {t('sharedReport.comparedWith', { name: prior.name })}
          </p>
        </>
      )}
    </div>
  )
}

/**
 * One insight.
 *
 * `affectedSegments` is not on this shape and is not on the wire: it is a free list of
 * segment names the generator wrote, and it passes through none of the aggregation that
 * applies the floor — so a department too small to keep its row above could be named
 * beside a finding about it.
 */
function InsightBlock({ insight }: { insight: ReportAIInsight }) {
  const { locale } = useTranslation()
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-surface-icon-box px-3.5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="m-0 text-base font-semibold text-fg-primary">{insight.title}</h3>
        <span className="font-mono text-xs tabular-nums text-fg-tertiary">
          {formatMetric(insight.confidenceScore, { kind: 'percentage' }, locale)}
        </span>
      </div>
      <p className="m-0 text-sm leading-snug text-fg-secondary">{insight.description}</p>
      {insight.recommendedActions.length > 0 && (
        <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-sm text-fg-secondary">
          {insight.recommendedActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The three standing promises at the foot of the artboard. */
function PrivacyNotes({ floor, hasOpenText }: { floor: number; hasOpenText: boolean }) {
  const { t } = useTranslation()
  return (
    <section
      aria-label={t(`${K}.notesLabel`)}
      className="grid grid-cols-1 gap-5 rounded-xl border border-line-default bg-surface-card px-5 py-4 shadow-sm sm:grid-cols-2 xl:grid-cols-3"
    >
      <PrivacyNote icon={<EyeOff />} title={t(`${K}.noteTextTitle`)}>
        {hasOpenText
          ? t(`${K}.noteTextBodyPresent`, { floor })
          : t(`${K}.noteTextBodyAbsent`, { floor })}
      </PrivacyNote>
      <PrivacyNote icon={<ShieldCheck />} title={t(`${K}.noteAbsentTitle`)}>
        {t(`${K}.noteAbsentBody`)}
      </PrivacyNote>
      <PrivacyNote icon={<Link2Off />} title={t(`${K}.noteLinkTitle`)}>
        {t(`${K}.noteLinkBody`)}
      </PrivacyNote>
    </section>
  )
}

/**
 * The line under the groups reading.
 *
 * Names, never headcounts: a withheld group's name is already on its hatched row, and the
 * count of people behind it is the figure the floor exists to hide.
 */
function groupsNote(
  section: SharedSection,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: string,
): string {
  // A withheld survey has no readable group by construction, and saying it "reports no
  // groups" would be a claim about the survey rather than about the floor that is hiding
  // it. The notice under the readings says the same thing at length.
  if (section.suppressed) return t(`${K}.groupsSuppressed`, { floor: section.floor })
  if (section.groups.total === 0) return t(`${K}.groupsNone`)
  if (section.groups.withheldNames.length === 0) {
    return t(`${K}.groupsAllReadable`, { floor: section.floor })
  }
  return t(`${K}.groupsWithheldNames`, {
    names: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format([
      ...section.groups.withheldNames,
    ]),
    floor: section.floor,
  })
}

/**
 * `'en' | 'es'` as a name a reader recognises, falling back to the server's own value —
 * printing `sharedReport.languageXx` at a reader is worse than printing the code.
 */
function contentLanguageName(t: (key: string) => string, locale: string): string {
  const keys: Record<string, string> = { en: 'language.english', es: 'language.spanish' }
  const key = keys[locale]
  return key ? t(key) : locale
}

/** Which of the three reasons a benchmark has no prior period to compare against. */
function priorPeriodSentence(status: string, t: (key: string) => string): string {
  if (status === 'none') return t('sharedReport.priorPeriodNone')
  if (status === 'unlinked') return t('sharedReport.priorPeriodUnlinked')
  return t('sharedReport.priorPeriodUnavailable')
}
