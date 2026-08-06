import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import LoginPage from '../auth/LoginPage'
import AcceptInvitationPage from '../features/org-structure/pages/AcceptInvitationPage'
import RequireAuth from './RequireAuth'
import AdminLayout from './AdminLayout'
import RouteErrorBoundary from './RouteErrorBoundary'
import CompaniesListPage from '../features/org-structure/pages/CompaniesListPage'
import CompanyDetailPage from '../features/org-structure/pages/CompanyDetailPage'
import UsersListPage from '../features/org-structure/pages/UsersListPage'
import SystemSettingsPage from '../features/org-structure/pages/SystemSettingsPage'
import DemographicFieldsPage from '../features/org-structure/pages/DemographicFieldsPage'
import ActionPlansListPage from '../features/action-plans/pages/ActionPlansListPage'
import ActionPlanDetailPage from '../features/action-plans/pages/ActionPlanDetailPage'
import MicroclimatesListPage from '../features/microclimates/pages/MicroclimatesListPage'
import MicroclimateDetailPage from '../features/microclimates/pages/MicroclimateDetailPage'
import MicroclimateRespondPage from '../features/microclimates/pages/MicroclimateRespondPage'
import NotificationPreferencesPage from '../features/notifications/pages/NotificationPreferencesPage'
import NotificationsInboxPage from '../features/notifications/pages/NotificationsInboxPage'
import BenchmarksPage from '../features/analytics/pages/BenchmarksPage'
import AIInsightsPage from '../features/analytics/pages/AIInsightsPage'
import ReportsListPage from '../features/reports/pages/ReportsListPage'
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
      { path: '/accept-invitation/:token', element: <AcceptInvitationPage /> },
      { path: '/microclimates/:id/respond', element: <MicroclimateRespondPage /> },
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
              { path: '/action-plans', element: <ActionPlansListPage /> },
              { path: '/action-plans/:id', element: <ActionPlanDetailPage /> },
              { path: '/microclimates', element: <MicroclimatesListPage /> },
              { path: '/microclimates/:id', element: <MicroclimateDetailPage /> },
              // Not under /admin: every authenticated role owns their own preferences,
              // and the API behind this page takes no user id at all (#103).
              { path: '/settings/notifications', element: <NotificationPreferencesPage /> },
              // Self-service, so no role gate beyond RequireAuth: /notifications/mine
              // is scoped per user and every authenticated role can load it.
              { path: '/notifications', element: <NotificationsInboxPage /> },
              { path: '/analytics/benchmarks', element: <BenchmarksPage /> },
              { path: '/analytics/ai-insights', element: <AIInsightsPage /> },
            ],
          },
        ],
      },
    ],
  },
])
