import { useCallback, useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { Link } from 'react-router'
import { listMySurveys, type MySurveyListItem } from '../api/surveys'
import { useTranslation } from '../../../i18n'
import type { TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Button,
  Chip,
  EmptyState,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'
import { calendarDay } from '../../../lib/calendarDay'

/**
 * The respondent-facing list — one of the very few non-admin pages in the product.
 *
 * ## Why there is no role check, and why that is the correct shape here
 *
 * Every other page in this app either gates on a role or scopes itself from a claim.
 * This one does neither, deliberately. `GET /surveys/my` resolves the caller's **own
 * user row** — by `sub`, then by external id, then by email — and filters by that
 * row's company and department. It reads no role claim at all, which is what makes it
 * loadable by `employee`, `supervisor` and `leader`, the three roles that until now
 * had exactly one page (`/notifications`) they could open.
 *
 * Reading the department from the user row rather than from the JWT is the endpoint's
 * own choice and it matters: department membership moves, and a token minted before a
 * transfer would otherwise keep serving the old team's surveys until it expired.
 *
 * A **global** super admin (`User.CompanyId` is NULL since #191) belongs to no tenant,
 * so the endpoint returns an empty list rather than an error — correct, and the reason
 * this page needs no super-admin special case either. It is also why `navSections.ts`
 * does not offer this entry to `super_admin`: an always-empty page is not a
 * destination.
 *
 * ## The design draws two groups; the API can currently fill one
 *
 * The approved screen splits the list into what is **open to you** and a **Closed**
 * group beneath it. `GET /surveys/my` goes through `SurveyQueries.AssignedTo`, which
 * hard-filters `Status == SurveyStatuses.Active` *and* excludes anything the caller
 * has already completed. So no closed survey can reach this page today, and the
 * Closed group therefore renders only when the payload actually carries a row whose
 * answering window has already ended — which is empty in practice.
 *
 * That partition is derived from `endDate`, not from a status, because
 * `MySurveyListItem` carries no status: it is the deliberately reduced projection
 * (no company, no author, no response count, no settings, no questions), and a page
 * reading `status` off it would typecheck against `SurveyListItem` and render
 * `undefined`. "The window has ended" is the closest observable fact to "closed" that
 * this payload contains, and it is honest about being a derivation rather than a
 * report.
 *
 * Inventing a second endpoint to fill the group was the alternative and is worse: it
 * would put a survey-history read on the respondent surface, which is the one place
 * in the product that must not accumulate a record of what an individual answered.
 * The footnote at the bottom of the screen says exactly that, and it is rendered
 * whether or not the group above it has any rows — it explains an absence as much as
 * it explains a row.
 *
 * ## Two facts the old table carried and this screen does not
 *
 * `anonymous` and `timeLimitMinutes` were columns here. The design's row has four
 * slots — title, reading line, one chip, one action — and neither fact is in them.
 * Anonymity moved up to the page's own description and to the footnote, which say it
 * once for the whole list rather than per row; the time *limit* is a cap rather than
 * a reading time, so it is not the "about N minutes" figure and belongs on the
 * respond screen, next to the clock it constrains.
 */
export default function MySurveysPage() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [surveys, setSurveys] = useState<MySurveyListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSurveys(await listMySurveys(baseUrl, locale))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, locale, t])

  useEffect(() => {
    reload()
  }, [reload])

  // One clock reading for the whole render, so every row on the page agrees about
  // which day "today" is — two `Date.now()` calls either side of a midnight tick
  // would put one row in the open group and the next in the closed one.
  const now = Date.now()
  const open = surveys.filter((survey) => !hasClosed(survey, now))
  const closed = surveys.filter((survey) => hasClosed(survey, now))

  return (
    <div>
      <PageTopBar
        title={t('navigation.mySurveys')}
        description={t('employee.mySurveysDescription')}
      />

      {error ? (
        <NetworkError
          title={t('errors.generic')}
          description={error}
          onRetry={reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={loading} label={t('common.loading')}>
          {loading ? (
            <SkeletonText lines={4} />
          ) : surveys.length === 0 ? (
            // `fill` is the centred block the other primary empty states use, rather
            // than a stub stranded at the top of a full-height card.
            <EmptyState
              fill
              title={t('employee.mySurveysEmptyTitle')}
              description={t('employee.mySurveysEmptyBody')}
            />
          ) : (
            <>
              {open.length > 0 && (
                <div className="grid gap-panel-gap">
                  {open.map((survey) => (
                    <OpenSurveyRow key={survey.id} survey={survey} now={now} />
                  ))}
                </div>
              )}

              {closed.length > 0 && (
                <section className="mt-section">
                  {/* Same rule as `dashboard/dashboardGrammar.tsx`'s `SectionHeading`:
                      13px rather than the bare `h2`'s 20px, because the redesign's
                      section headings are quieter than the readings under them. Not
                      imported from there — that module is the *dashboards'* grammar,
                      and one heading is not worth a cross-feature dependency. */}
                  <h2 className="mb-inline text-base">{t('employee.mySurveysClosedHeading')}</h2>
                  <div className="grid gap-panel-gap">
                    {closed.map((survey) => (
                      <ClosedSurveyRow key={survey.id} survey={survey} />
                    ))}
                  </div>
                </section>
              )}

              {/* `text-fg-secondary`, not tertiary: #818181 on the panel measures
                  3.90:1, which fails WCAG AA for body text. See `PageTopBar`. */}
              <p className="mb-0 mt-panel max-w-measure text-xs text-fg-secondary">
                {t('employee.mySurveysFootnote')}
              </p>
            </>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

/**
 * A survey still open to the reader: what it is, how long it will take, how long is
 * left, and the one action.
 *
 * The accent frame and the amber chip are **one** rule, not two decisions. The design
 * draws its first row accented with an amber "6 days left" and the row beneath it
 * plain with a quiet chip, and nothing in `MySurveyListItem` distinguishes those two
 * rows except how soon they close. So closing soon is what lights the row up, and the
 * chip that says so wears the matching tone. Accenting *every* open row was the
 * alternative and is worse: on the common payload — where nothing has closed and the
 * Closed group does not render — it would paint the whole page one colour and mark
 * nothing.
 */
function OpenSurveyRow({ survey, now }: { survey: MySurveyListItem; now: number }) {
  const { t, locale } = useTranslation()
  const days = daysUntilClose(survey.endDate, now)
  const closingSoon = days !== null && days <= CLOSING_SOON_DAYS

  return (
    <div
      data-slot="my-survey-row"
      data-open="true"
      className={
        closingSoon
          ? 'flex flex-wrap items-center gap-panel rounded-xl border border-accent-blue-ring bg-accent-blue-soft p-3'
          : 'flex flex-wrap items-center gap-panel rounded-xl border border-line-light bg-surface-panel p-3'
      }
    >
      <div className="min-w-0 grow basis-64">
        <p className="mb-0 break-words text-base font-semibold text-fg-primary">
          {survey.title ?? t('surveys.untitled')}
        </p>
        <p className="mb-0 break-words text-xs text-fg-secondary">
          {readingLine(survey, t, locale)}
        </p>
      </div>
      {days !== null && (
        <Chip tone={closingSoon ? 'warning' : 'neutral'} label={timeLeftLabel(days, t)} />
      )}
      {/* A real destination: `/surveys/:id/respond` is a registered route, and the
          respond endpoint authorizes it per user rather than per role. */}
      <Button asChild size="sm" variant="primary">
        <Link to={`/surveys/${survey.id}/respond`}>{t('dashboard.respondNow')}</Link>
      </Button>
    </div>
  )
}

/**
 * A survey whose window has ended.
 *
 * The chip is the whole point of the row and is why the design lists closed surveys
 * at all: it says *"not recorded as yours"* rather than a tick, because the product
 * genuinely does not know whether this reader answered — `SurveyResponse.UserId` is
 * NULL on an anonymous response. The only action is outward, to what the company did
 * with the answers, because there is nothing of the reader's own left to open.
 */
function ClosedSurveyRow({ survey }: { survey: MySurveyListItem }) {
  const { t, locale } = useTranslation()

  return (
    <div
      data-slot="my-survey-row"
      data-open="false"
      className="flex flex-wrap items-center gap-panel rounded-xl border border-line-light bg-surface-panel p-3"
    >
      <div className="min-w-0 grow basis-64">
        <p className="mb-0 break-words text-base font-semibold text-fg-primary">
          {survey.title ?? t('surveys.untitled')}
        </p>
        <p className="mb-0 break-words text-xs text-fg-secondary">
          {t('employee.closedMeta', { date: calendarDay(Date.parse(survey.endDate), locale) })}
        </p>
      </div>
      <Chip
        tone="neutral"
        icon={<Lock className="size-3" />}
        label={t('employee.notRecordedChip')}
      />
      <Button asChild size="sm" variant="default">
        <Link to="/dashboard">{t('employee.seeWhatCameOfIt')}</Link>
      </Button>
    </div>
  )
}

/** Days from today to the closing day, past which the chip goes amber and the row lights up. */
const CLOSING_SOON_DAYS = 7

const MS_PER_DAY = 86_400_000

/**
 * Whole calendar days from `now` until the survey's closing day, or `null` when the
 * date does not parse.
 *
 * Counted in **UTC calendar days**, not in elapsed milliseconds, for the reason
 * `lib/calendarDay.ts` gives at length: `EndDate` is a calendar day stored as a UTC
 * midnight, so `2026-09-12T00:00:00Z` means "the twelfth" and not an instant. Dividing
 * the raw difference by a day would make "closes today" flip to "1 day left" at any
 * hour except midnight, and would disagree with the date printed beside it.
 */
function daysUntilClose(endDate: string, now: number): number | null {
  const end = Date.parse(endDate)
  if (Number.isNaN(end)) return null
  return Math.floor(end / MS_PER_DAY) - Math.floor(now / MS_PER_DAY)
}

/**
 * Whether the answering window has already ended.
 *
 * This is the page's stand-in for "closed" — see the note on the component above for
 * why the payload cannot simply be asked. An unparseable date is treated as open: a
 * survey the reader might still owe an answer to is the safer side of that guess.
 */
function hasClosed(survey: MySurveyListItem, now: number): boolean {
  const days = daysUntilClose(survey.endDate, now)
  return days !== null && days < 0
}

/**
 * "about 8 minutes" — the design's figure for its twelve-question survey, i.e. forty
 * seconds a question.
 *
 * The floor is **2**, not 1, because the catalogue has one plural form: a two-question
 * survey would otherwise read "about 1 minutes". A single-question survey does not go
 * through here at all — it gets `surveyMetaOneQuestion`, which says "under a minute".
 */
function readingMinutes(questionCount: number): number {
  return Math.max(2, Math.round((questionCount * 2) / 3))
}

/** `12 questions · about 8 minutes · closes 12 Sep`. */
function readingLine(survey: MySurveyListItem, t: TranslateFn, locale: string): string {
  const date = calendarDay(Date.parse(survey.endDate), locale)
  // `<= 1` rather than `=== 1`: a zero-question survey cannot be published (the
  // publish gate refuses it), so the branch is unreachable, but "under a minute" is
  // the less wrong of the two things it could say if one ever arrived.
  return survey.questionCount <= 1
    ? t('employee.surveyMetaOneQuestion', { date })
    : t('employee.surveyMeta', {
        questions: survey.questionCount,
        minutes: readingMinutes(survey.questionCount),
        date,
      })
}

/** The time-left chip's word. Separate keys rather than a plural rule the catalogue has no room for. */
function timeLeftLabel(days: number, t: TranslateFn): string {
  if (days <= 0) return t('employee.taskClosesToday')
  if (days === 1) return t('employee.oneDayLeftChip')
  return t('employee.daysLeftChip', { days })
}
