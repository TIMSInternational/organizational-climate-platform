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
import DashboardPage from '../features/dashboard/pages/DashboardPage'
import CompaniesListPage from '../features/org-structure/pages/CompaniesListPage'
import CompanyDetailPage from '../features/org-structure/pages/CompanyDetailPage'
import UsersListPage from '../features/org-structure/pages/UsersListPage'
import SystemSettingsPage from '../features/org-structure/pages/SystemSettingsPage'
import SystemHealthPage from '../features/org-structure/pages/SystemHealthPage'
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
import PublicSurveyLinkPage from '../features/surveys/pages/PublicSurveyLinkPage'
import SurveyInvitationPage from '../features/surveys/pages/SurveyInvitationPage'
import NotificationPreferencesPage from '../features/notifications/pages/NotificationPreferencesPage'
import ProfilePage from '../features/profile/pages/ProfilePage'
import NotificationsInboxPage from '../features/notifications/pages/NotificationsInboxPage'
import SurveyDistributionPage from '../features/surveys/pages/SurveyDistributionPage'
import BenchmarksPage from '../features/analytics/pages/BenchmarksPage'
import AIInsightsPage from '../features/analytics/pages/AIInsightsPage'
import ReportsListPage from '../features/reports/pages/ReportsListPage'
import SurveyResultsPage from '../features/surveys/pages/SurveyResultsPage'
import SurveysListPage from '../features/surveys/pages/SurveysListPage'
import SurveyCreatePage from '../features/surveys/pages/SurveyCreatePage'
import SurveyDetailPage from '../features/surveys/pages/SurveyDetailPage'
import SurveyQuestionsEditPage from '../features/surveys/pages/SurveyQuestionsEditPage'
import MySurveysPage from '../features/surveys/pages/MySurveysPage'
import SurveyTemplatesPage from '../features/surveys/pages/SurveyTemplatesPage'
import SurveyTemplateDetailPage from '../features/surveys/pages/SurveyTemplateDetailPage'
import AnalyticsDashboardPage from '../features/analytics/pages/AnalyticsDashboardPage'
import { resolveInitialRoute } from './resolveInitialRoute'

// /admin/companies (the old unconditional target) is SuperAdmin-only -- a
// company_admin (or anyone else) landing on `/` needs routing to whatever page
// their role can actually load, same as a fresh login (see LoginPage.tsx).
//
// Since #132 that is `/dashboard` for everyone: the page dispatches on the role
// claim itself, so nothing has to be decoded here to pick a destination. Kept as a
// component rather than a bare `<Navigate to="/dashboard">` so the one place that
// decides "where does a signed-in user land" stays `resolveInitialRoute`, shared
// with LoginPage and AuthSuccessPage.
function HomeRedirect() {
  return <Navigate to={resolveInitialRoute()} replace />
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
/**
 * The tracking module's routes (#125, #126), declared in one place.
 *
 * ## Why they are together and lazy
 *
 * The module is a *separate surface* from the generic `/action-plans` — Federico's
 * decision of 2026-08-21 — and it exists only where a deployment has configured a
 * `services/tracking-api` to talk to (see `features/tracking/api/config.ts`). Every
 * other deployment ships these pages and never reaches them, so they are route-level
 * `lazy` imports and land in their own chunks rather than in the main bundle: the
 * same mechanism `/dev/chart-gallery` uses above, for the same reason.
 *
 * Route-level `lazy` rather than `React.lazy` + `<Suspense>`, again as above: the
 * router awaits it during navigation, so no fallback element is needed and the
 * dynamic import stays inline here instead of in a statically-imported wrapper.
 *
 * ## The three that are missing, and why they cannot be here yet
 *
 * #125 owns the route table for the whole module so it is edited once, and the
 * remaining three paths belong to #126's pages:
 *
 *     { path: '/tracking/planes', lazy: … 'PlanesAccionListPage' },
 *     { path: '/tracking/planes/:id', lazy: … 'PlanAccionDetailPage' },
 *     { path: '/tracking/mis-tareas', lazy: … 'MisTareasPage' },
 *
 * They are written out rather than registered because a dynamic `import()` of a
 * module that does not exist is a **build** failure, not a runtime one — Rollup
 * resolves it while bundling — so declaring them against files this branch does not
 * contain would make `npm run build` fail here and in CI. Adding placeholder pages
 * instead would put two authors on three files and ship three screens that lie. So
 * #126 pastes those three entries into this array beside the two below; the shape,
 * the paths and the filenames are settled here and nothing else about the table
 * moves.
 *
 * `/tracking/planes` is declared before `/tracking/planes/:id` when they arrive, for
 * readability only — react-router ranks a static segment above a dynamic one
 * whatever the declaration order.
 */
const trackingRoutes: RouteObject[] = [
  {
    path: '/tracking',
    lazy: async () => ({
      Component: (await import('../features/tracking/pages/ConsolidadoPage')).default,
    }),
  },
  {
    // `?nodoId=` rather than `/tracking/tablero/:nodoId`, and that is a contract
    // with the endpoint: `GET /api/tablero-seguimiento` takes `nodoId` as an
    // optional QUERY parameter and answers with the CALLER'S OWN nodo when it is
    // absent. A path parameter would make the id mandatory in the URL, which is
    // exactly wrong for the node leader — the role this screen is for — who has
    // one board and should not have to know its external id to open it.
    path: '/tracking/tablero',
    lazy: async () => ({
      Component: (await import('../features/tracking/pages/TableroSeguimientoPage')).default,
    }),
  },
]

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
      // The two links this product actually distributes, and the reason they are here
      // rather than under the gate: neither is followed by somebody with a session.
      //
      // `/s/:token` is the exact path `SurveyAccessTokens.PublicLinkPath` builds and
      // `survey_distributions.public_url` stores, so the literal is not a choice made
      // here — it is a contract with a string the API has already written into rows,
      // printed on QR codes and handed to administrators to copy. Anything else and the
      // links already in circulation stay broken.
      //
      // `/survey-invitations/:token` mirrors the API route of the same name, but for a
      // weaker reason: nothing mails this one. The token is minted in
      // `SurveyDistributionEndpoints` and read back only by the four routes under that
      // path — no mailer composes it and no admin screen reveals it, deliberately, since
      // it is a bearer credential for one employee's survey. The producer it waits on is
      // the invitation email.
      { path: '/s/:token', element: <PublicSurveyLinkPage /> },
      { path: '/survey-invitations/:token', element: <SurveyInvitationPage /> },
      ...devOnlyRoutes,
      {
        element: <RequireAuth />,
        children: [
          // #120's authenticated half. Gated like everything else under
          // `RequireAuth` — an employee sent a survey their company does not run
          // anonymously has to sign in, and the test below this file pins that this
          // route is NOT a top-level one beside `/survey/:id`.
          //
          // But outside `AdminLayout`, beside the gate rather than inside the shell.
          // The respondent surface is the same page whether the answerer holds a
          // token or not: `SurveyRespondPage` and `PublicSurveyRespondPage` both
          // render `RespondShell` around one `SurveyRespondForm`. Wrapping this one
          // in the administrator's rail — role-aware nav, company switcher,
          // notification bell, sign-out — put an administration frame around the
          // only screen an ordinary employee ever sees, and made the two halves of
          // one flow look like two different products.
          //
          // No role gate of its own: the respond endpoint resolves the caller's own
          // user row and checks the survey's department targets itself, so every
          // role that can be sent a survey can load this.
          { path: '/surveys/:id/respond', element: <SurveyRespondPage /> },
          {
            element: <AdminLayout />,
            children: [
              // #132. One route for all four role dashboards: the page dispatches by
              // role, and each role's endpoint refuses the other three, so there is no
              // per-role route to gate and nothing a wrong guess here could leak.
              { path: '/dashboard', element: <DashboardPage /> },
              { path: '/admin/companies', element: <CompaniesListPage /> },
              { path: '/admin/companies/:id', element: <CompanyDetailPage /> },
              { path: '/admin/companies/:companyId/users', element: <UsersListPage /> },
              { path: '/admin/companies/:companyId/demographic-fields', element: <DemographicFieldsPage /> },
              { path: '/admin/companies/:companyId/reports', element: <ReportsListPage /> },
              { path: '/admin/companies/:companyId/analytics', element: <AnalyticsDashboardPage /> },
              { path: '/admin/system-settings', element: <SystemSettingsPage /> },
              { path: '/admin/system', element: <SystemHealthPage /> },
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
              // `/surveys/:id/respond` used to be declared here. It is now a sibling
              // of this whole `AdminLayout` branch, one level up — see the comment
              // beside it for why the respondent surface is not in the admin shell.
              // No nav entry, deliberately: this is a per-survey destination reached from
              // a survey, not a place in the sidebar. `/surveys` and `/surveys/:id` are
              // #109's; this route only needs to exist beneath one of them.
              { path: '/surveys/:id/results', element: <SurveyResultsPage /> },
              // #273. Same rule as `/surveys/:id/results` above: no nav entry, because it
              // is a per-survey destination reached from a survey. The way in is on
              // `SurveyDetailPage`, offered only when the survey can actually be edited —
              // but the page defends itself anyway, since this URL is typeable and the
              // server's second refusal (any response row exists) cannot be predicted from
              // a read.
              { path: '/surveys/:id/questions', element: <SurveyQuestionsEditPage /> },
              // Not under /admin, and gated by nothing beyond RequireAuth: every
              // authenticated role — plain employees included — owns a profile, and
              // every endpoint behind this page resolves the caller from their own
              // token and takes no user id at all (#136).
              { path: '/profile', element: <ProfilePage /> },
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
              // The tracking module (#125, #126). Inside `AdminLayout` like every
              // other work surface — these are administration screens, not a
              // respondent flow — and gated by nothing beyond `RequireAuth`,
              // because each page reads its own role claim and the tracking
              // service authorizes every call itself. See `trackingRoutes` above.
              ...trackingRoutes,
            ],
          },
        ],
      },
    ],
  },
])
