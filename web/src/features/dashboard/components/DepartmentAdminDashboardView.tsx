import { useCallback } from 'react'
import { Link } from 'react-router'
// `Inbox` is the glyph `navSections` already gives `/surveys/my` in the sidebar, so the
// action and the nav row that share a destination also share a mark.
import { AlertTriangle, Inbox, Info } from 'lucide-react'
import { getDepartmentAdminDashboard } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import DashboardState from './DashboardState'
import DashboardSurveyTable from './DashboardSurveyTable'
import EmployeeDashboardView from './EmployeeDashboardView'
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
  const { data: result, loading, failed, error, reload } = useDashboardData(load)

  const data = result?.kind === 'department' ? result.dashboard : null

  // Responses per 100 members, or null where there is nobody to divide by. Rounded, because
  // a rate quoted to a decimal implies a precision a headcount this small does not have.
  const rate =
    data && data.memberCount > 0
      ? Math.round((data.completedResponseCount / data.memberCount) * 100)
      : null

  // A leader or supervisor whose user row carries no department has no team dashboard —
  // not a failed one, an absent one. This route is where every role lands after login
  // (`resolveInitialRoute`), so before #138 that user's first screen after signing in was
  // a red panel reading "The authenticated user is not assigned to a department", in
  // English, inside a Spanish page, over a Retry button that could never succeed.
  //
  // The fallback is the employee view rather than an empty state, because it is not empty:
  // `GET /dashboard/employee` reads no role claim and resolves the caller's own row, so it
  // answers everyone — and a team lead with no team still has surveys of their own to
  // answer. The notice says why they are looking at it, so a silent substitution cannot be
  // mistaken for a bug. Same reasoning `DashboardPage` gives for defaulting an unknown role
  // to this view, arrived at from the other direction.
  if (result?.kind === 'no-department') {
    return (
      <EmployeeDashboardView
        notice={
          // `variant="info"` and the default `role="status"`, both load-bearing. The screen
          // this replaced was a red error panel, and the substance of the fix is that
          // having no team assigned is not an error and not something to interrupt a
          // screen reader with — it is a standing condition with a sentence explaining it.
          // `DepartmentAdminDashboardView.test.tsx` asserts both.
          <Alert variant="info">
            <Info aria-hidden="true" />
            <AlertTitle>{t('dashboard.noDepartmentTitle')}</AlertTitle>
            <AlertDescription>{t('dashboard.noDepartmentBody')}</AlertDescription>
          </Alert>
        }
      />
    )
  }

  // The other 400 this endpoint sends: the token resolved to no user row at all. Falling
  // back to the employee dashboard would be pointless and worse than pointless —
  // `EmployeeAsync` resolves the *same* row and answers the same 400, so the fallback drew
  // the server's raw English string in a red panel over a dead Retry, underneath a notice
  // telling this person they merely had no department yet. Both sentences on one screen,
  // one of them false. This says the one true thing instead, in the reader's language, and
  // offers no retry because there is nothing a retry could change. See `api/dashboard.ts`.
  if (result?.kind === 'no-user-record') {
    return (
      <div>
        <PageTopBar title={t('dashboard.title')} />
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t('dashboard.noUserRecordTitle')}</AlertTitle>
          <AlertDescription>{t('dashboard.noUserRecordBody')}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div>
      <PageTopBar
        eyebrow={data?.departmentName ?? null}
        title={t('dashboard.title')}
        description={t('dashboard.departmentDashboardDescription')}
        // The one action on a page that had none at all, and its absence was the
        // finding rather than an oversight. Every figure on this screen is a
        // read-only team aggregate, and the loudest element on it — the overdue
        // alert — deliberately offers no button because `/action-plans` 403s this
        // role. So a leader or supervisor arriving here after login (this route is
        // `resolveInitialRoute`'s destination for them) landed on a page with no
        // next step anywhere in the content column.
        //
        // What they are missing is specifically their OWN work: a supervisor is an
        // evaluated employee too, and `EmployeeDashboardView` leads with a hero card
        // and a "Start answering" button for the surveys they owe. Being promoted out
        // of that view takes the personal call to action away and puts nothing in its
        // place — the participation rate above counts this reader's own answer among
        // the missing ones without ever saying so.
        //
        // A link and not a second fetch. `GET /dashboard/employee` would carry the
        // pending count, but this component is contracted to one endpoint and adding a
        // second request to draw a number is a behaviour change, not a design one. The
        // page already knows where the answer lives, so it points there.
        //
        // `/surveys/my` and not `/tracking/mis-tareas`: the first is in `SELF_SERVICE`
        // and loads for every role in every deployment, while the second is
        // `requiresTracking` and would be a dead link wherever no tracking service is
        // configured. `roleCapabilities.ts` records both facts, and
        // `DepartmentAdminDashboardView.test.tsx` re-checks every href on this page
        // against `canReach` for BOTH roles that see it — the guard that caught the
        // `/action-plans` button this page used to carry.
        actions={
          <Button asChild size="sm" variant="primary">
            <Link to="/surveys/my">
              <Inbox aria-hidden="true" />
              {t('navigation.mySurveys')}
            </Link>
          </Button>
        }
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
                    {/* No button, and its absence is the fix (#138).
                        `ActionPlanEndpoints.CanAccessCompany` is `super_admin`, or a
                        `company_admin` on their own company — there is no
                        department-scoped read of `/action-plans` at all. This alert is
                        rendered only for `leader` and `supervisor`, so the primary
                        button that used to sit here linked 100% of its viewers to
                        "Request failed: 403". Photographed as a leader before the fix.
                        `navigation/roleCapabilities.ts` records why, and
                        `DepartmentAdminDashboardView.test.tsx` fails if any link on this
                        page leaves the set these two roles can load.

                        A count they cannot open is still worth printing: a leader who
                        knows their team has overdue plans can ask for them, and the
                        server has no other way to tell them. Naming whose screen it is
                        beats a dead end, and beats hiding the number. */}
                    <p className="mb-0 mt-inline text-sm text-fg-secondary">
                      {t('dashboard.overduePlansNotYours')}
                    </p>
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
