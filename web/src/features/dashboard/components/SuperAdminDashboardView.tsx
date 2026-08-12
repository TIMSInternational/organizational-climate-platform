import { useCallback } from 'react'
import { getSuperAdminDashboard } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import { calendarDay } from '../calendarDay'
import DashboardState from './DashboardState'
import { KpiRow, MonoReadings, SectionHeading } from './dashboardGrammar'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KpiTile } from '../../../components/charts'
import { EmptyState, Table } from '../../../components/ui'

/**
 * The platform overview — every tenant, and the only dashboard that crosses tenant lines.
 *
 * There is no company filter and no company picker here on purpose: this is the one view
 * whose subject genuinely is "all of them". A SuperAdmin who has selected a company in the
 * header switcher gets the company dashboard instead — see `DashboardPage`.
 *
 * `GET /dashboard/super-admin` refuses every other role outright, so this component can
 * never be rendered with somebody else's data in it; there is nothing to hide client-side.
 *
 * ## The header, and the five counts that became four
 *
 * "Platform" is the eyebrow and "Dashboard" the title, which is the shape every other screen
 * uses: the page is titled after what it is, and the scope it covers sits above. This view
 * previously titled itself "Super Admin Dashboard", naming the reader's role rather than the
 * subject — the only screen in the product that did.
 *
 * The old `KPIDisplay` grid at `columns={3}` wrapped five cards into a ragged 3-then-2 second
 * row. Three of those five were pairs measuring the same thing (users and *active* users;
 * surveys and *active* surveys), so each pair folds into one tile with the total as its
 * sub-line, and responses do the same. Four readings, four across, and each one now states
 * what its denominator is instead of leaving the reader to pair up two boxes.
 */
export default function SuperAdminDashboardView() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  // Stable, because `useDashboardData` depends on it — see the note there.
  const load = useCallback(() => getSuperAdminDashboard(baseUrl), [baseUrl])
  const { data, loading, failed, error, reload } = useDashboardData(load)


  return (
    <div>
      <PageTopBar
        eyebrow={t('dashboard.platform')}
        title={t('dashboard.title')}
        description={t('dashboard.superAdminDescription')}
      />

      <DashboardState loading={loading} failed={failed} error={error} onRetry={reload}>
        {data && (
          <div className="flex flex-col gap-section">
            <KpiRow>
              <KpiTile
                label={t('dashboard.totalCompanies')}
                value={data.companyCount}
                locale={locale}
              />
              <KpiTile
                label={t('dashboard.totalUsers')}
                value={data.userCount}
                locale={locale}
                sub={
                  <MonoReadings
                    locale={locale}
                    t={t}
                    messageKey="dashboard.activeOfMembers"
                    params={{ active: data.activeUserCount }}
                  />
                }
              />
              <KpiTile
                label={t('dashboard.activeSurveys')}
                value={data.activeSurveyCount}
                locale={locale}
                sub={
                  <MonoReadings
                    locale={locale}
                    t={t}
                    messageKey="dashboard.ofTotalSurveys"
                    params={{ total: data.surveyCount }}
                  />
                }
              />
              <KpiTile
                label={t('dashboard.completedResponses')}
                value={data.completedResponseCount}
                locale={locale}
                sub={
                  <MonoReadings
                    locale={locale}
                    t={t}
                    messageKey="dashboard.ofTotalResponses"
                    params={{ total: data.responseCount }}
                  />
                }
              />
            </KpiRow>

            <section>
              <SectionHeading>{t('dashboard.companyPerformance')}</SectionHeading>
              {data.companies.length > 0 ? (
                <Table>
                  {/* The redesign's micro-label, `text-fg-secondary` for contrast — see
                      `DashboardSurveyTable` for the measurement. */}
                  <thead className="text-2xs uppercase tracking-label text-fg-secondary">
                    <tr>
                      <th>{t('dashboard.companyName')}</th>
                      <th>{t('navigation.users')}</th>
                      <th>{t('dashboard.activeSurveys')}</th>
                      <th>{t('dashboard.completedResponses')}</th>
                      <th>{t('dashboard.added')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.companies.map((company) => (
                      <tr key={company.id}>
                        <td>{company.name}</td>
                        <td className="font-mono tabular-nums">{company.userCount}</td>
                        <td className="font-mono tabular-nums">{company.activeSurveyCount}</td>
                        <td className="font-mono tabular-nums">
                          {company.completedResponseCount}
                        </td>
                        {/* UTC, not the browser's zone: a calendar day, and a reader west of
                            UTC was shown the day before. See `calendarDay`. */}
                        <td className="whitespace-nowrap font-mono tabular-nums">
                          {calendarDay(Date.parse(company.createdAt), locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState
                  title={t('dashboard.noCompaniesYet')}
                  description={t('dashboard.startByAddingFirstCompany')}
                />
              )}
            </section>
          </div>
        )}
      </DashboardState>
    </div>
  )
}
