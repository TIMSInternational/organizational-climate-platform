import { useCallback } from 'react'
import { Link } from 'react-router'
import { EyeOff } from 'lucide-react'
import { getEmployeeDashboard, type DashboardPendingSurvey } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import { calendarDay } from '../../../lib/calendarDay'
import DashboardState from './DashboardState'
import LastOutcomePanel from './LastOutcomePanel'
import { MonoReadings } from './dashboardGrammar'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { Button, Chip, EmptyState, type ChipTone } from '../../../components/ui'

/**
 * The evaluated user's Home — the landing experience for a plain employee.
 *
 * ## Scoped per user, not per role
 *
 * `GET /dashboard/employee` resolves the caller's **own** user row and reports on that row
 * alone; it reads no role claim. So this is also what a leader or supervisor sees of their
 * own outstanding work — nothing on this payload describes anybody else, which is why it
 * needs no guard of its own.
 *
 * ## The four KPI tiles are gone, and one of them could never have been right
 *
 * Home used to open on SURVEYS AWAITING YOU / DAYS UNTIL THE NEXT CLOSES / SURVEYS YOU HAVE
 * COMPLETED / UNREAD NOTIFICATIONS. Walked against the live API as a seeded employee, three
 * of the four read zero, and none of them answered the question the person opened the page
 * with — *is there anything I have to do?* The approved design cuts all four and gives that
 * question the whole top of the screen.
 *
 * "Surveys you have completed" is the one worth recording rather than merely deleting.
 * `SurveyResponseEndpoints.cs:102` stores `IsAnonymous ? null : ActingUserId`, and its own
 * comment calls that "the one place the distinction between 'unknown' and 'deliberately not
 * recorded' is collapsed, on purpose". Against an anonymous survey every response row's
 * `user_id` is therefore NULL and the tile can only ever read 0 — for a person who *did*
 * answer. The number was right and the tile was wrong, and any completion history, streak or
 * "you answered 4 of 5" is a promise this product has already decided not to be able to
 * keep. It is deleted rather than fixed. `LastOutcomePanel` is what replaces it: if we
 * cannot say what *you* did, we can say what *came of it*.
 *
 * ## Two states, and no zeros in the quiet one
 *
 * Something waiting: one prominent task card for the nearest survey, the rest as quieter
 * rows beneath it. Nothing waiting: the shared `EmptyState`, centred, saying so in words.
 * The old view drew a "0" tile and an empty table in that case, which is the same fact
 * spelled as a measurement of nothing.
 *
 * The deadline `Alert` is gone too. It only appeared when something was already due, which
 * is exactly what the task card's own "Closes today" chip says, in the place the reader is
 * already looking.
 *
 * ## Why the list can be shorter than the count
 *
 * `DashboardEndpoints.SurveyRowLimit` is 5, so `pendingSurveyCount` is the true total while
 * `pendingSurveys` is the first page of it. When they disagree the page says so and links to
 * `/surveys/my`, which is the whole list — the old view rendered the capped table with no
 * hint that anything had been left off it.
 *
 * ## The anonymity chip, and why it is only ever an affirmation
 *
 * The design leads the task card with it, and the whole employee experience is an argument
 * for that one promise, so `DashboardPendingSurvey.anonymous` is now projected from the
 * survey's own `Settings.Anonymous` — the same column `/surveys/{id}/respond` reads for
 * `SurveyRespondView.anonymous`. One source, so the chip on this card and the promise on the
 * page it opens cannot contradict each other.
 *
 * **The chip is drawn only when the flag is `true`, and a survey that is not anonymous gets
 * no chip at all.** Not a "Not anonymous" chip: this card is a two-second glance on the way
 * into a questionnaire, and a chip is read as a property of the thing it sits on before its
 * word is read. The negative belongs where the reader has stopped to take it in — the respond
 * page opens on `surveyRespond.identifiedTitle` and a paragraph explaining it. Getting the
 * gate backwards would tell somebody their answers are untraceable on a survey that records
 * exactly who they are, which is the worst sentence this product could utter — so it is
 * tested in both directions, and mutating the gate either way fails a test.
 *
 * ## What the payload still cannot support
 *
 * The design's task card also carries a paragraph of survey description.
 * `Survey.DescriptionEn/Es` exist on the entity but are not projected onto this DTO, so it is
 * omitted until the server sends it rather than invented here.
 */
export interface EmployeeDashboardViewProps {
  /**
   * A band drawn between the page header and the work, explaining why this page is the one
   * being shown.
   *
   * Exists for exactly one caller: `DepartmentAdminDashboardView` falls back to this view
   * when the server says the caller has no department (#138), and a leader who silently
   * got a different page than the one their role implies would have no way to tell whether
   * something was broken. Optional, and absent for the employee this page is named after —
   * for them it is simply their page, and there is nothing to explain.
   *
   * A node rather than a string so the caller owns the shape it wants; this view only owns
   * where it sits.
   */
  notice?: React.ReactNode
}

export default function EmployeeDashboardView({ notice }: EmployeeDashboardViewProps = {}) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const load = useCallback(() => getEmployeeDashboard(baseUrl, locale), [baseUrl, locale])
  const { data, loading, failed, error, reload } = useDashboardData(load)

  const [next, ...rest] = data?.pendingSurveys ?? []
  // The count is the truth and the list is a page of it (SurveyRowLimit = 5).
  const beyondTheList = (data?.pendingSurveyCount ?? 0) > (data?.pendingSurveys.length ?? 0)

  return (
    <div>
      <PageTopBar
        // The department, as the design has it — this page is addressed to a person, and
        // the eyebrow says where they stand. `employee.eyebrow` covers the user who
        // belongs to no department; `null` while loading, because an eyebrow that appears
        // and then changes is worse than one that arrives with its page.
        eyebrow={data ? (data.departmentName ?? t('employee.eyebrow')) : null}
        // The greeting IS the heading here. This is the one page in the product addressed
        // to an individual rather than to an administrator, and a report title over it
        // would be the wrong voice.
        title={data ? t(greetingKey(new Date().getHours()), { name: data.name }) : t('dashboard.myDashboard')}
        description={
          data
            ? data.pendingSurveyCount > 0
              ? t('employee.homeDescription')
              : t('employee.homeDescriptionNothingDue')
            : undefined
        }
      />

      <div className="flex flex-col gap-section">
        {/* Above `DashboardState`, so it is on screen while the work below is still
            loading and stays on screen if that load fails. The reason this page is the one
            being shown does not depend on the request succeeding. */}
        {notice}

        <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
          {data && (
            <div className="flex flex-col gap-panel-gap">
              {next ? (
                <>
                  {/* The prototype's `.task`: the accent-tinted block that is the only
                      thing on this page anybody has to act on. */}
                  <div className="rounded-xl border border-accent-blue-ring bg-accent-blue-soft p-panel">
                    {/* The design's `.task .top`: the chips on one line, anonymity first.
                        It leads because it is the thing a respondent decides on before
                        they look at the deadline. */}
                    <div className="flex flex-wrap items-center gap-inline">
                      <AnonymousChip anonymous={next.anonymous} t={t} />
                      <ClosesChip endDate={next.endDate} t={t} variant="task" />
                    </div>
                    <h2 className="mb-0 mt-inline text-xl">{next.title ?? t('surveys.untitled')}</h2>

                    {/* Three readings, in mono, as the design sets them. `dl` because
                        each is a labelled value rather than a row of a table. */}
                    <dl className="my-panel flex flex-wrap gap-panel">
                      <Reading label={t('employee.taskQuestions')}>
                        {next.questionCount.toLocaleString(locale)}
                      </Reading>
                      <Reading label={t('employee.taskAbout')}>
                        <MonoReadings
                          t={t}
                          locale={locale}
                          messageKey="employee.taskMinutes"
                          params={{ minutes: estimatedMinutes(next.questionCount) }}
                        />
                      </Reading>
                      <Reading label={t('employee.taskCloses')}>
                        {/* UTC, not the browser's zone: these are calendar days, and a
                            reader west of UTC was shown the day before. See `calendarDay`. */}
                        {calendarDay(Date.parse(next.endDate), locale)}
                      </Reading>
                    </dl>

                    {/* `/surveys/:id/respond` is registered and authorized per user by the
                        respond endpoint itself. */}
                    <Button asChild variant="primary">
                      <Link to={`/surveys/${next.id}/respond`}>{t('employee.startAnswering')}</Link>
                    </Button>
                  </div>

                  {rest.length > 0 && (
                    <ul className="m-0 grid list-none gap-panel-gap p-0">
                      {rest.map((survey) => (
                        <PendingRow key={survey.id} survey={survey} t={t} locale={locale} />
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <EmptyState
                  title={t('dashboard.noPendingSurveys')}
                  // Department-aware where there is a department to name: "no survey is
                  // open to Engineering" is a fact about this reader, where the generic
                  // line is a fact about the app.
                  description={
                    data.departmentName
                      ? t('employee.emptyBodyInDepartment', { department: data.departmentName })
                      : t('dashboard.noPendingSurveysDescription')
                  }
                />
              )}

              {/* Only when the page is genuinely showing less than it was told about. */}
              {beyondTheList && (
                <Button asChild variant="link" className="w-fit">
                  <Link to="/surveys/my">{t('navigation.mySurveys')}</Link>
                </Button>
              )}
            </div>
          )}
        </DashboardState>

        {/* Outside `DashboardState` on purpose: it fetches in parallel with the payload
            above rather than after it, and it draws nothing at all when it has nothing —
            including when Home itself has failed. */}
        <LastOutcomePanel />
      </div>
    </div>
  )
}

/**
 * Which greeting, by the reader's own clock.
 *
 * Noon and six are the boundaries English uses; the catalogue owns the words, and a locale
 * whose day is cut differently can only be served by different *strings*, not by moving
 * these numbers under everyone else's feet.
 */
function greetingKey(hour: number): string {
  if (hour < 12) return 'employee.greetingMorning'
  if (hour < 18) return 'employee.greetingAfternoon'
  return 'employee.greetingEvening'
}

/**
 * How long the survey takes, from the only input the payload offers.
 *
 * The design reads "12 questions · about 8 minutes", i.e. two thirds of a minute each, and
 * that ratio is what is implemented. Floored at one minute, because "about 0 min" is not an
 * estimate. It is deliberately coarse: the number is prefixed "about" in every catalogue,
 * and a survey that reported `estimatedMinutes` per question would be a server field rather
 * than this arithmetic.
 */
function estimatedMinutes(questionCount: number): number {
  return Math.max(1, Math.round((questionCount * 2) / 3))
}

/**
 * Whole days until a close date, floored at zero — or null when the date is unusable.
 *
 * A deadline already past is not "-3 days left"; it is nothing left, and "Closes today" is
 * what says so. `Math.ceil` rather than `floor`: a survey closing in eight hours has a day
 * left to the reader, not none.
 */
function daysUntil(endDate: string): number | null {
  const at = Date.parse(endDate)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.ceil((at - Date.now()) / 86_400_000))
}

/**
 * The anonymity chip — an affirmation, or nothing.
 *
 * ## One direction only
 *
 * `anonymous === true` draws "Anonymous" with the eye-off glyph, exactly as `RespondShell`
 * draws it beside the brand lockup on the page this card leads to — same key, same icon,
 * same accent tone, because it is the same promise seen twice rather than two claims that
 * happen to agree. Anything else draws nothing.
 *
 * There is deliberately no `false` branch. `surveyRespond.identifiedChip` ("Not anonymous")
 * exists and is rendered on the respond page, where it sits under a heading and a paragraph
 * that explain what is recorded; on a task card it would be a warning label with no room for
 * its own explanation, on a screen a reader crosses in two seconds. The comparison is against
 * a literal `true` rather than a truthiness test, so that nothing else can ever be read as a
 * promise: a field gone missing — an older server, a cached body — reads as no claim at all,
 * which is the only safe way to read silence here.
 *
 * ## Why the label is `surveyRespond.anonymousChip`
 *
 * The `employee` namespace has no anonymity chip of its own, and inventing one would be two
 * catalogue entries for one word that must never disagree between the card and the page it
 * opens. This is the same reuse `employeeCopy.test.ts` records for the rest of the respond
 * vocabulary these screens borrow.
 */
function AnonymousChip({ anonymous, t }: { anonymous: boolean; t: TranslateFn }) {
  if (anonymous !== true) return null

  return (
    <Chip
      tone="accent"
      label={t('surveyRespond.anonymousChip')}
      icon={<EyeOff aria-hidden="true" className="size-3" />}
    />
  )
}

/**
 * The countdown chip.
 *
 * Two vocabularies for one fact, because the two places it appears are asking different
 * questions. On the task card the reader is deciding whether to start now, so it is a
 * sentence — "Closes in 6 days". On a quieter row it is a comparison against the rows
 * around it, so it is a measurement — "6 days left".
 *
 * The tone ladder is the design's amber at six days, extended at both ends: due today is
 * critical because it is the last chance, and anything beyond a week is neutral because a
 * warning that is always lit is one a reader learns to skip. Nothing is drawn at all for an
 * unparseable date — a chip is a claim, and there is nothing here to claim.
 */
function ClosesChip({
  endDate,
  t,
  variant,
}: {
  endDate: string
  t: TranslateFn
  variant: 'task' | 'row'
}) {
  const days = daysUntil(endDate)
  if (days === null) return null

  const tone: ChipTone = days === 0 ? 'critical' : days <= 7 ? 'warning' : 'neutral'
  const label =
    variant === 'task'
      ? days === 0
        ? t('employee.taskClosesToday')
        : days === 1
          ? t('employee.taskClosesInOneDay')
          : t('employee.taskClosesInDays', { days })
      : days === 1
        ? t('employee.oneDayLeftChip')
        : t('employee.daysLeftChip', { days })

  return <Chip tone={tone} label={label} />
}

/** One labelled reading on the task card — the prototype's `.task .meta dt/dd` pair. */
function Reading({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-2xs font-semibold uppercase tracking-label text-fg-label">{label}</dt>
      <dd className="m-0 font-mono font-semibold tabular-nums">{children}</dd>
    </div>
  )
}

/**
 * A survey behind the first one — the prototype's `.srow`, quieter than the task above it.
 *
 * Its one-line summary reuses `employee.surveyMeta`, which My surveys also renders: the two
 * screens describe the same row of the same list, and two spellings of "12 questions · about
 * 8 minutes · closes 12 Sep" is how they drift apart.
 */
function PendingRow({
  survey,
  t,
  locale,
}: {
  survey: DashboardPendingSurvey
  t: TranslateFn
  locale: string
}) {
  return (
    <li className="flex flex-wrap items-center gap-panel rounded-lg border border-line-light bg-surface-panel px-card py-3">
      <div className="min-w-0 grow basis-64">
        <p className="m-0 font-medium">{survey.title ?? t('surveys.untitled')}</p>
        <p className="m-0 text-xs text-fg-secondary">
          {survey.questionCount === 1 ? (
            <MonoReadings
              t={t}
              locale={locale}
              messageKey="employee.surveyMetaOneQuestion"
              params={{ date: calendarDay(Date.parse(survey.endDate), locale) }}
            />
          ) : (
            <MonoReadings
              t={t}
              locale={locale}
              messageKey="employee.surveyMeta"
              params={{
                questions: survey.questionCount,
                minutes: estimatedMinutes(survey.questionCount),
                date: calendarDay(Date.parse(survey.endDate), locale),
              }}
            />
          )}
        </p>
      </div>
      <ClosesChip endDate={survey.endDate} t={t} variant="row" />
      <Button asChild size="sm">
        <Link to={`/surveys/${survey.id}/respond`}>{t('dashboard.respondNow')}</Link>
      </Button>
    </li>
  )
}
