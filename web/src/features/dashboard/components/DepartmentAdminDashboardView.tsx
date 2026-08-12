import { useCallback } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, Target } from 'lucide-react'
import { getDepartmentAdminDashboard } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import DashboardState from './DashboardState'
import DashboardSurveyTable from './DashboardSurveyTable'
import { KpiRow, MonoReadings, SectionHeading } from './dashboardGrammar'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KpiTile } from '../../../components/charts'
import { Alert, AlertDescription, AlertTitle, Button } from '../../../components/ui'

/**
 * One department's overview, for the person who runs it.
 *
 * **No department id is sent.** A leader or supervisor's department comes from their own
 * user row on the server, not from this client and not from their token: people move teams,
 * and a token minted before a transfer would keep serving the old team's numbers until it
 * expired. Naming a department here would also be a scope the client chose — the server
 * refuses one that is not the caller's own.
 *
 * `leader` and `supervisor` both land here. This repo has no `department_admin` role; those
 * two are its department-scoped roles, and both run a team.
 *
 * ## The header shape, and why the department is the eyebrow
 *
 * `CompanyAdminDashboardView` puts the tenant in the eyebrow and "Dashboard" in the title,
 * on the reasoning that the page is always the same page and what changes between visits is
 * which company it is about. The same argument applies one level down, so the department is
 * the eyebrow here. It also fixes a real inconsistency: this view used to put the department
 * name in the `<h1>`, so a leader's document heading was "Engineering" while every other
 * screen in the product titled itself after what the screen *is*.
 *
 * ## Why the readings are a rate and not five counts
 *
 * This view rendered five `KPIDisplay` cards at `columns={3}`, which wrapped 3-then-2 into a
 * ragged second row under an "Overview" heading. The redesign's row is four `KpiTile` across
 * in mono, so the five became four by folding overdue plans into the open-plans tile as its
 * sub-line — where it belongs, being a subset of the same number rather than a peer of it.
 *
 * Participation leads, as it does on the company view, and for the same reason it is a rate
 * per 100 people rather than a percentage: this counts responses, not people, so three
 * surveys can put one member on the numerator three times and "150%" would read as a bug.
 * A team with no members has nothing to divide by, and the tile draws an em dash rather
 * than claiming a rate of zero that was never measured.
 *
 * ## What is deliberately NOT here
 *
 * No climate map. The department payload carries `completedResponseCount` and no scores at
 * all — not per dimension, not overall — so there is nothing to lay against a target. The
 * company hero has the same gap and the same cause; when the per-dimension aggregation
 * lands, this screen is the second caller for it, scoped to one department.
 *
 * The response count is printed rather than withheld below the anonymity floor. That is the
 * *existing* behaviour of this view and of `DashboardSurveyTable`, and changing it is a
 * policy call rather than a redesign one: a leader looking at their own team already knows
 * its size, which is not the same disclosure as publishing one department's sub-floor count
 * to a company admin reading all of them. `DepartmentList` withholds it in the second case.
 * Flagged rather than decided here.
 */
export default function DepartmentAdminDashboardView() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const load = useCallback(
    () => getDepartmentAdminDashboard(baseUrl, { lang: locale }),
    [baseUrl, locale],
  )
  const { data, loading, failed, error, reload } = useDashboardData(load)

  // Responses per 100 members, or null where there is nobody to divide by. Rounded, because
  // a rate quoted to a decimal implies a precision a headcount this small does not have.
  const rate =
    data && data.memberCount > 0
      ? Math.round((data.completedResponseCount / data.memberCount) * 100)
      : null

  return (
    <div>
      <PageTopBar
        eyebrow={data?.departmentName ?? null}
        title={t('dashboard.title')}
        description={t('dashboard.departmentDashboardDescription')}
      />

      <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
        {data && (
          <div className="flex flex-col gap-section">
            <KpiRow>
              <KpiTile
                label={t('dashboard.responsesPer100')}
                value={rate}
                locale={locale}
                sub={
                  <MonoReadings
                    locale={locale}
                    t={t}
                    messageKey="dashboard.responsesFromPeople"
                    params={{
                      completed: data.completedResponseCount,
                      people: data.memberCount,
                    }}
                  />
                }
              />
              <KpiTile
                label={t('dashboard.teamMembers')}
                value={data.memberCount}
                locale={locale}
                sub={
                  <MonoReadings
                    locale={locale}
                    t={t}
                    messageKey="dashboard.activeOfMembers"
                    params={{ active: data.activeMemberCount }}
                  />
                }
              />
              <KpiTile
                label={t('dashboard.activeSurveys')}
                value={data.activeSurveyCount}
                locale={locale}
              />
              <KpiTile
                label={t('dashboard.openActionPlans')}
                value={data.openActionPlanCount}
                locale={locale}
                // Overdue is a subset of open, not a peer of it, so it reads as this tile's
                // sub-line rather than as a fifth tile. `higherIsBetter` is not set: there
                // is no previous value to compare against, so no tone is claimed.
                sub={
                  <MonoReadings
                    locale={locale}
                    t={t}
                    messageKey="dashboard.overdueOfOpen"
                    params={{ overdue: data.overdueActionPlanCount }}
                  />
                }
              />
            </KpiRow>

            {/* The one thing most worth the reader's attention, and only when it exists.
                An always-present panel that usually says "nothing is wrong" trains a
                reader to skip the place where the warning will eventually appear. */}
            {data.overdueActionPlanCount > 0 && (
              <section>
                <SectionHeading>{t('dashboard.needsAttention')}</SectionHeading>
                <Alert variant="warning">
                  <AlertTriangle aria-hidden="true" />
                  <AlertTitle>{t('dashboard.overdueActionPlans')}</AlertTitle>
                  <AlertDescription>
                    <MonoReadings
                      locale={locale}
                      t={t}
                      messageKey="dashboard.overduePlansBody"
                      params={{
                        overdue: data.overdueActionPlanCount,
                        department: data.departmentName,
                      }}
                    />
                    <Button asChild size="sm" variant="primary" className="mt-inline w-fit">
                      <Link to="/action-plans">
                        <Target aria-hidden="true" />
                        {t('navigation.actionPlans')}
                      </Link>
                    </Button>
                  </AlertDescription>
                </Alert>
              </section>
            )}

            <section>
              <SectionHeading>{t('dashboard.currentOngoingSurveys')}</SectionHeading>
              {/* No target column. `Survey.TargetAudienceCount` is one tenant-wide number
                  the author typed in, with no per-department breakdown, so on this page it
                  would sit directly beneath the department-scoped participation reading
                  above and describe a different population. The responses column here IS
                  department-scoped — the server counts this department's rows rather than
                  reading the survey's denormalised company-wide tally. */}
              <DashboardSurveyTable surveys={data.activeSurveys} showTarget={false} />
            </section>
          </div>
        )}
      </DashboardState>
    </div>
  )
}
