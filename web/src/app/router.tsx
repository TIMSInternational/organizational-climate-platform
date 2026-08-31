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
import PrivacySettingsPage from '../features/profile/pages/PrivacySettingsPage'
import NotificationsInboxPage from '../features/notifications/pages/NotificationsInboxPage'
import SurveyDistributionPage from '../features/surveys/pages/SurveyDistributionPage'
import BenchmarksPage from '../features/analytics/pages/BenchmarksPage'
import AIInsightsPage from '../features/analytics/pages/AIInsightsPage'
import ReportsListPage from '../features/reports/pages/ReportsListPage'
import SharedReportPage from '../features/reports/pages/SharedReportPage'
import SurveyResultsPage from '../features/surveys/pages/SurveyResultsPage'
import ClimateTrendsPage from '../features/surveys/pages/ClimateTrendsPage'
import SurveysListPage from '../features/surveys/pages/SurveysListPage'
import SurveyCreatePage from '../features/surveys/pages/SurveyCreatePage'
import SurveyDetailPage from '../features/surveys/pages/SurveyDetailPage'
import SurveyQuestionsEditPage from '../features/surveys/pages/SurveyQuestionsEditPage'
import MySurveysPage from '../features/surveys/pages/MySurveysPage'
import SurveyTemplatesPage from '../features/surveys/pages/SurveyTemplatesPage'
import SurveyTemplateDetailPage from '../features/surveys/pages/SurveyTemplateDetailPage'
import AnalyticsDashboardPage from '../features/analytics/pages/AnalyticsDashboardPage'
import QuestionBankPage from '../features/questions/pages/QuestionBankPage'
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
 * ## All five are here, and that is the whole point of this table
 *
 * #125 owned the route table for the module so it would be edited once, and while
 * the two slices were in flight this array held only #125's own two paths with the
 * other three written out in a comment — a dynamic `import()` of a file the branch
 * does not contain is a **build** failure, not a runtime one, since Rollup resolves
 * it while bundling.
 *
 * The cost of that arrangement was the thing worth recording: #126 shipped four
 * pages and 4034 lines that NOTHING imported, so Rollup tree-shook the lot and the
 * feature was absent from the bundle while its own tests passed. "The tests pass"
 * and "this is in the product" are different claims, and only a route table
 * connects them. `router.test.ts` now reads this file and asserts every tracking
 * page under `features/tracking/pages/` is registered here, so a page added without
 * a path fails rather than silently disappearing.
 *
 * `/tracking/planes` is declared before `/tracking/planes/:id` for readability only
 * — react-router ranks a static segment above a dynamic one whatever the
 * declaration order.
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
  {
    path: '/tracking/planes',
    lazy: async () => ({
      Component: (await import('../features/tracking/pages/PlanesAccionListPage')).default,
    }),
  },
  {
    path: '/tracking/planes/:id',
    lazy: async () => ({
      Component: (await import('../features/tracking/pages/PlanDeAccionDetailPage')).default,
    }),
  },
  {
    // The involucrado's view. `MisTareasAsync` scopes to the caller's own `sub`
    // claim, so this path takes no parameter and cannot be pointed at anyone else.
    path: '/tracking/mis-tareas',
    lazy: async () => ({
      Component: (await import('../features/tracking/pages/MisTareasPage')).default,
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
      // #115. The shared question picker is a dialog inside step 4 of a wizard, and
      // `scripts/shot.mjs` photographs a ROUTE — it cannot click. Same dev-only
      // mechanism as the gallery above, and asserted the same way in router.test.ts.
      {
        path: '/dev/question-library',
        lazy: async () => ({
          Component: (await import('../features/questions/pages/QuestionLibraryDevPage')).default,
        }),
      },
      // The storefront visual language on one route, so `npm run shot` can
      // photograph it in both themes. Same dev-only mechanism as the two above.
      {
        path: '/dev/storefront',
        lazy: async () => ({
          Component: (await import('../features/storefront/pages/StorefrontGalleryPage')).default,
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
      // `/survey-invitations/:token` mirrors the API route of the same name, and this is
      // now the path the invitation email actually mails. The token is minted in
      // `SurveyDistributionEndpoints`, never persisted into `notifications.data`, and
      // resolved by `EmailNotificationSender` at send time — so no admin screen and no
      // notification listing ever reveals it, which matters because it is a bearer
      // credential for one employee's survey.
      //
      // The literal is a contract with a string the API already composes into outbound
      // mail: `SurveyAccessTokens.InvitationLinkPrefix` builds `/survey-invitations/` on
      // the C# side, and no reference connects it to this line. Renaming this route
      // breaks every link already sitting in a recipient's inbox and no .NET test will
      // notice, so it moves only in lockstep with that constant.
      { path: '/s/:token', element: <PublicSurveyLinkPage /> },
      { path: '/survey-invitations/:token', element: <SurveyInvitationPage /> },
      // #139, and out here for a reason the two routes above only half share.
      //
      // They are public because their visitor has no account. This one is public because
      // it is the *consumption side of a share link*: a report sent to a board member, an
      // auditor, a ministry contact — people the product has no user row for and never
      // will. `RequireAuth` renders `<Navigate to="/login" replace />` with no `state.from`
      // and no `?next=`, so it does not defer the destination, it destroys it: a visitor
      // sent to sign in could not return to the report even if they had credentials.
      //
      // `/shared/reports/` is the legacy path (`src/app/shared/reports/[token]/page.tsx`
      // over `api/shared/reports/[token]`), kept literal for the same reason `/s/:token`
      // is: links already in circulation are the contract. Nothing in this repository
      // mints one yet — `GET /shared/reports/{token}` is not mapped by the API — so today
      // every token here resolves to the page's single "not available" state, which is
      // also what an expired or revoked one will resolve to. See SharedReportPage.tsx.
      { path: '/shared/reports/:token', element: <SharedReportPage /> },
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
              // #114, the question BANK — not the question library, which is #112's
              // picker and lives behind `/dev/question-library`. The two reach
              // different tables on purpose; `questionBank.ts` and
              // `QuestionBankEndpoints.cs` both say why.
              //
              // No route-level role gate, matching every sibling here: every
              // `/admin/question-bank` route checks `Roles.Admin` and then scopes by
              // role, so a leader or employee who typed the URL gets the page's own
              // error state rather than another tenant's corpus. `navSections.ts` is
              // what keeps it out of their sidebar.
              { path: '/admin/question-bank', element: <QuestionBankPage /> },
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
              // Same static-beats-dynamic ranking again, so `climate-trends` is never
              // parsed as a survey id. Unlike `/surveys/:id/results` this one IS in the
              // sidebar: it is a company-level reading rather than a per-survey
              // destination, and there is no survey to reach it from.
              { path: '/surveys/climate-trends', element: <ClimateTrendsPage /> },
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
              // #137, and gated the same way for the same reason. `GET /gdpr/access` with
              // no `userId` is the self-service case and needs no role — the handler says
              // so — so every authenticated role reaches this page and none of them can
              // ask it about anybody else. Under `/settings` beside notification
              // preferences rather than under `/admin`: the erasure endpoint IS admin
              // surface, but nothing on this page calls it.
              { path: '/settings/privacy', element: <PrivacySettingsPage /> },
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
