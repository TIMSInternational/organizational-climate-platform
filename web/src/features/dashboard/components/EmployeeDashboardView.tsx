import { useCallback } from 'react'
import { Link } from 'react-router'
import { CalendarClock } from 'lucide-react'
import { getEmployeeDashboard } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import { calendarDay } from '../../../lib/calendarDay'
import DashboardState from './DashboardState'
import { KpiRow, MonoReadings, SectionHeading } from './dashboardGrammar'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KpiTile } from '../../../components/charts'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  EmptyState,
  Table,
} from '../../../components/ui'
import { typeLabel } from '../../surveys/surveyVocabulary'

/**
 * The evaluated user's dashboard — the landing experience for a plain employee, and the
 * thing #132 exists most to fix. Until now this role logged in and was sent to a list page.
 *
 * ## Scoped per user, not per role
 *
 * `GET /dashboard/employee` resolves the caller's **own** user row and reports on that row
 * alone; it reads no role claim. So this component is also what a leader or supervisor
 * would see of their own outstanding work — nothing on this payload describes anybody else,
 * which is why it needs no guard of its own.
 *
 * ## Why the pending list carries no response count
 *
 * `DashboardPendingSurvey` deliberately omits it, exactly as `/surveys/my` does. A
 * respondent told how many colleagues have already answered has been handed a headcount of
 * an anonymous survey.
 *
 * ## The greeting stays the title; the structure is the redesign's
 *
 * This is the one page in the product addressed to a person rather than to an administrator,
 * and the greeting as the heading is a deliberate choice worth keeping. What changes is
 * everything around it: the old `KPIDisplay` card grid at `columns={3}` becomes the
 * redesign's four-across `KpiTile` row in mono, and the department moves into the eyebrow so
 * the header reads the same way it does on the other twelve screens.
 *
 * ## Why "days left" is a tile and not just a banner
 *
 * The deadline was an `Alert` under the readings, which put the most actionable fact on the
 * page — how long you have — below three counts that do not change what you do next. As a
 * reading it earns a place in the row, and the banner then only appears when something is
 * actually overdue. `nextDeadline` is the soonest close across ALL pending surveys, not
 * merely the listed page of them, so it is the right number to count down.
 *
 * A null deadline draws an em dash rather than a zero: "no pending survey has a close date"
 * and "it closes today" are different facts and must not render the same.
 */
export default function EmployeeDashboardView() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const load = useCallback(() => getEmployeeDashboard(baseUrl, locale), [baseUrl, locale])
  const { data, loading, failed, error, reload } = useDashboardData(load)

  // Whole days from today, floored at zero. A deadline already past is not "-3 days left";
  // it is nothing left, and the banner below is what says so.
  const deadlineAt = data?.nextDeadline ? Date.parse(data.nextDeadline) : null
  const daysLeft =
    deadlineAt === null || Number.isNaN(deadlineAt)
      ? null
      : Math.max(0, Math.ceil((deadlineAt - Date.now()) / 86_400_000))
  const overdue = daysLeft === 0 && (data?.pendingSurveyCount ?? 0) > 0

  return (
    <div>
      <PageTopBar
        eyebrow={data?.departmentName ?? null}
        // The person's own name, when the server knows it. `dashboard.welcomeName` reads
        // as a greeting rather than a report heading, which is right for the one page in
        // this product addressed to an individual rather than to an administrator.
        title={data ? t('dashboard.welcomeName', { name: data.name }) : t('dashboard.myDashboard')}
        description={t('dashboard.myDashboardDescription')}
      />

      <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
        {data && (
          <div className="flex flex-col gap-section">
            <KpiRow>
              <KpiTile
                label={t('dashboard.pendingSurveys')}
                value={data.pendingSurveyCount}
                locale={locale}
              />
              <KpiTile
                label={t('dashboard.daysUntilNextClose')}
                value={daysLeft}
                locale={locale}
                sub={
                  deadlineAt === null ? undefined : (
                    <span className="font-mono tabular-nums">
                      {calendarDay(deadlineAt, locale)}
                    </span>
                  )
                }
              />
              <KpiTile
                label={t('dashboard.completedSurveys')}
                value={data.completedSurveyCount}
                locale={locale}
              />
              <KpiTile
                label={t('dashboard.unreadNotifications')}
                value={data.unreadNotificationCount}
                locale={locale}
              />
            </KpiRow>

            {/* Only when something is actually late. A banner that is always on the page
                is a banner a reader learns to look past. */}
            {overdue && (
              <section>
                <SectionHeading>{t('dashboard.needsAttention')}</SectionHeading>
                <Alert variant="warning">
                  <CalendarClock aria-hidden="true" />
                  <AlertTitle>{t('dashboard.closingToday')}</AlertTitle>
                  <AlertDescription>
                    <MonoReadings
                      locale={locale}
                      t={t}
                      messageKey="dashboard.closingTodayBody"
                      params={{ pending: data.pendingSurveyCount }}
                    />
                  </AlertDescription>
                </Alert>
              </section>
            )}

            <section>
              <SectionHeading>{t('dashboard.pendingSurveys')}</SectionHeading>
              {data.pendingSurveys.length > 0 ? (
                <Table>
                  {/* The redesign's micro-label, and `text-fg-secondary` rather than
                      tertiary — see `DashboardSurveyTable` for the contrast measurement. */}
                  <thead className="text-2xs uppercase tracking-label text-fg-secondary">
                    <tr>
                      <th>{t('surveys.surveyName')}</th>
                      <th>{t('surveys.surveyType')}</th>
                      <th>{t('surveys.questions')}</th>
                      <th>{t('surveys.closesOn')}</th>
                      <th>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pendingSurveys.map((survey) => (
                      <tr key={survey.id}>
                        <td>{survey.title ?? t('surveys.untitled')}</td>
                        <td>{typeLabel(t, survey.type)}</td>
                        <td className="font-mono tabular-nums">{survey.questionCount}</td>
                        {/* UTC, not the browser's zone: these are calendar days, and a
                            reader west of UTC was shown the day before. See `calendarDay`. */}
                        <td className="whitespace-nowrap font-mono tabular-nums">
                          {calendarDay(Date.parse(survey.endDate), locale)}
                        </td>
                        <td>
                          {/* A real destination: `/surveys/:id/respond` is registered and is
                              authorized per user by the respond endpoint itself. */}
                          <Button asChild size="sm" variant="primary">
                            <Link to={`/surveys/${survey.id}/respond`}>
                              {t('dashboard.respondNow')}
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState
                  title={t('dashboard.noPendingSurveys')}
                  description={t('dashboard.noPendingSurveysDescription')}
                />
              )}
            </section>
          </div>
        )}
      </DashboardState>
    </div>
  )
}
