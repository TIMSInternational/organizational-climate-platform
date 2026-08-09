import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import LoginPage from '../auth/LoginPage'
import RegisterPage from '../auth/RegisterPage'
import AuthErrorPage from '../auth/AuthErrorPage'
import AccountInactivePage from '../auth/AccountInactivePage'
import AuthLoadingPage from '../auth/AuthLoadingPage'
import AuthSuccessPage from '../auth/AuthSuccessPage'
import AcceptInvitationPage from '../features/org-structure/pages/AcceptInvitationPage'
import RequireAuth from './RequireAuth'
import AdminLayout from './AdminLayout'
import RouteErrorBoundary from './RouteErrorBoundary'
import CompaniesListPage from '../features/org-structure/pages/CompaniesListPage'
import CompanyDetailPage from '../features/org-structure/pages/CompanyDetailPage'
import UsersListPage from '../features/org-structure/pages/UsersListPage'
import SystemSettingsPage from '../features/org-structure/pages/SystemSettingsPage'
import DemographicFieldsPage from '../features/org-structure/pages/DemographicFieldsPage'
import DepartmentsPage from '../features/org-structure/pages/DepartmentsPage'
import ActionPlansListPage from '../features/action-plans/pages/ActionPlansListPage'
import ActionPlanDetailPage from '../features/action-plans/pages/ActionPlanDetailPage'
import MicroclimatesListPage from '../features/microclimates/pages/MicroclimatesListPage'
import MicroclimateCreatePage from '../features/microclimates/pages/MicroclimateCreatePage'
import MicroclimateAnalyticsPage from '../features/microclimates/pages/MicroclimateAnalyticsPage'
import MicroclimateDetailPage from '../features/microclimates/pages/MicroclimateDetailPage'
import MicroclimateLivePage from '../features/microclimates/pages/MicroclimateLivePage'
import MicroclimateResultsPage from '../features/microclimates/pages/MicroclimateResultsPage'
import MicroclimateRespondPage from '../features/microclimates/pages/MicroclimateRespondPage'
import SurveyRespondPage from '../features/surveys/pages/SurveyRespondPage'
import PublicSurveyRespondPage from '../features/surveys/pages/PublicSurveyRespondPage'
import NotificationPreferencesPage from '../features/notifications/pages/NotificationPreferencesPage'
import NotificationsInboxPage from '../features/notifications/pages/NotificationsInboxPage'
import SurveyDistributionPage from '../features/surveys/pages/SurveyDistributionPage'
import BenchmarksPage from '../features/analytics/pages/BenchmarksPage'
import AIInsightsPage from '../features/analytics/pages/AIInsightsPage'
import ReportsListPage from '../features/reports/pages/ReportsListPage'
import SurveyResultsPage from '../features/surveys/pages/SurveyResultsPage'
import SurveysListPage from '../features/surveys/pages/SurveysListPage'
import SurveyCreatePage from '../features/surveys/pages/SurveyCreatePage'
import SurveyDetailPage from '../features/surveys/pages/SurveyDetailPage'
import MySurveysPage from '../features/surveys/pages/MySurveysPage'
import SurveyTemplatesPage from '../features/surveys/pages/SurveyTemplatesPage'
import SurveyTemplateDetailPage from '../features/surveys/pages/SurveyTemplateDetailPage'
import AnalyticsDashboardPage from '../features/analytics/pages/AnalyticsDashboardPage'
import { getToken } from '../auth/token'
import { decodeJwtPayload } from '../auth/jwt'
import { resolveInitialRoute } from './resolveInitialRoute'

// /admin/companies (the old unconditional target) is SuperAdmin-only -- a
// company_admin (or anyone else) landing on `/` needs routing to whatever page
// their role can actually load, same as a fresh login (see LoginPage.tsx).
function HomeRedirect() {
  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
  return <Navigate to={resolveInitialRoute(role, companyId)} replace />
}

/**
 * Routes that exist in development builds and nowhere else.
 *
 * Currently just the #79 chart gallery. It renders hardcoded sample data and makes
 * no API calls, so it leaks nothing — but it is not behind `RequireAuth`, and a
 * page whose whole job is to display placeholder numbers has no business being
 * reachable on a customer's deployment.
 *
 * `import.meta.env.DEV` is what makes that true rather than merely intended. Vite
 * replaces it with the literal `false` in a production build, so Rollup eliminates
 * this branch — and because the dynamic `import()` lives *inside* the branch, the
 * gallery module and its sample data are never reached, so no chunk is emitted for
 * them at all. Gating only the route entry would not achieve that: a static import
 * at the top of this file keeps the module in the graph and the chunk on disk,
 * unreachable but shipped. Asserted in router.test.ts and verified against a real
 * production build.
 *
 * Route-level `lazy` rather than `React.lazy` + `<Suspense>`: the router awaits it
 * during navigation, which needs no fallback element and keeps the dynamic import
 * inline here instead of in a wrapper component that would have to be statically
 * imported — defeating the point.
 */
const devOnlyRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/chart-gallery',
        lazy: async () => ({
          Component: (await import('../features/charts/pages/ChartGalleryPage')).default,
        }),
      },
    ]
  : []

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: '/', element: <HomeRedirect /> },
      { path: '/login', element: <LoginPage /> },
      // #81's auth states. All five sit OUTSIDE RequireAuth, beside /login, and
      // must: each of them is a state the app is in precisely because there is no
      // usable session, so putting them behind the gate would redirect them to
      // /login and lose the reason.
      //
      // /auth/inactive is the one exception worth naming -- its visitor DOES hold
      // a token. It is still public because RequireAuth is what sends them here,
      // and a guard that redirects into itself is a loop.
      //
      // /auth/loading is the Google OAuth `redirect_uri`. Its visitor is arriving
      // from accounts.google.com with an ID token and no session yet -- it is the
      // page that CREATES the session -- so it is public by definition.
      { path: '/register', element: <RegisterPage /> },
      { path: '/auth/error', element: <AuthErrorPage /> },
      { path: '/auth/inactive', element: <AccountInactivePage /> },
      { path: '/auth/loading', element: <AuthLoadingPage /> },
      { path: '/auth/success', element: <AuthSuccessPage /> },
      { path: '/accept-invitation/:token', element: <AcceptInvitationPage /> },
      { path: '/microclimates/:id/respond', element: <MicroclimateRespondPage /> },
      // Public by design (#120), same placement and same reason as the microclimate
      // respond route above it: an anonymous survey is answered by people who have no
      // account, so `RequireAuth` here would send every one of them to a login page
      // they cannot pass. The server still refuses this route for any survey that is
      // not both anonymous and open.
      { path: '/survey/:id', element: <PublicSurveyRespondPage /> },
      ...devOnlyRoutes,
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { path: '/admin/companies', element: <CompaniesListPage /> },
              { path: '/admin/companies/:id', element: <CompanyDetailPage /> },
              { path: '/admin/companies/:companyId/users', element: <UsersListPage /> },
              { path: '/admin/companies/:companyId/demographic-fields', element: <DemographicFieldsPage /> },
              { path: '/admin/companies/:companyId/reports', element: <ReportsListPage /> },
              { path: '/admin/companies/:companyId/analytics', element: <AnalyticsDashboardPage /> },
              { path: '/admin/system-settings', element: <SystemSettingsPage /> },
              // Flat, with no company id in the path (#142), like /surveys and
              // /action-plans: the page takes its company from `company-context`,
              // so one route and one nav entry serve both admin roles.
              { path: '/departments', element: <DepartmentsPage /> },
              { path: '/action-plans', element: <ActionPlansListPage /> },
              { path: '/action-plans/:id', element: <ActionPlanDetailPage /> },
              { path: '/microclimates', element: <MicroclimatesListPage /> },
              // Before `/microclimates/:id` for readability only, same as
              // `/surveys/my`: react-router ranks a static segment above a dynamic
              // one whatever the declaration order, so `new` can never be parsed as
              // a microclimate id.
              { path: '/microclimates/new', element: <MicroclimateCreatePage /> },
              { path: '/microclimates/analytics', element: <MicroclimateAnalyticsPage /> },
              { path: '/microclimates/:id', element: <MicroclimateDetailPage /> },
              // No nav entry, deliberately: both are per-session destinations reached
              // from the session, not places in the sidebar. Same rule as
              // `/surveys/:id/results`.
              { path: '/microclimates/:id/live', element: <MicroclimateLivePage /> },
              { path: '/microclimates/:id/results', element: <MicroclimateResultsPage /> },
              { path: '/surveys', element: <SurveysListPage /> },
              // Before `/surveys/:id` for the same static-beats-dynamic reason the
              // two entries below record: `new` is a literal segment and could never
              // be read as a survey id, so the order is readability only.
              { path: '/surveys/new', element: <SurveyCreatePage /> },
              // Before `/surveys/:id` for readability only -- react-router ranks a
              // static segment above a dynamic one regardless of declaration order,
              // so `/surveys/my` could never be swallowed as an id. (The API relies
              // on the same property, via the `:guid` route constraint.)
              //
              // Not gated beyond RequireAuth: `/surveys/my` scopes itself to the
              // caller's own user row and reads no role claim, so employee,
              // supervisor and leader can all load it. See MySurveysPage.tsx.
              { path: '/surveys/my', element: <MySurveysPage /> },
              // Same static-beats-dynamic ranking as `/surveys/my`, so `templates`
              // is never parsed as a survey id.
              { path: '/surveys/templates', element: <SurveyTemplatesPage /> },
              { path: '/surveys/templates/:id', element: <SurveyTemplateDetailPage /> },
              { path: '/surveys/:id', element: <SurveyDetailPage /> },
              // The authenticated half of #120. No role gate beyond RequireAuth: the
              // respond endpoint resolves the caller's own user row and checks the
              // survey's department targets itself, so every role that can be sent a
              // survey can load this.
              { path: '/surveys/:id/respond', element: <SurveyRespondPage /> },
              // No nav entry, deliberately: this is a per-survey destination reached from
              // a survey, not a place in the sidebar. `/surveys` and `/surveys/:id` are
              // #109's; this route only needs to exist beneath one of them.
              { path: '/surveys/:id/results', element: <SurveyResultsPage /> },
              // Not under /admin: every authenticated role owns their own preferences,
              // and the API behind this page takes no user id at all (#103).
              { path: '/settings/notifications', element: <NotificationPreferencesPage /> },
              // Self-service, so no role gate beyond RequireAuth: /notifications/mine
              // is scoped per user and every authenticated role can load it.
              { path: '/notifications', element: <NotificationsInboxPage /> },
              // Reached from a survey, not from the sidebar: distribution is an action on
              // one survey rather than a destination, so it gets a route and no nav entry.
              { path: '/surveys/:surveyId/distribution', element: <SurveyDistributionPage /> },
              { path: '/analytics/benchmarks', element: <BenchmarksPage /> },
              { path: '/analytics/ai-insights', element: <AIInsightsPage /> },
            ],
          },
        ],
      },
    ],
  },
])
