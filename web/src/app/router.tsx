import { createBrowserRouter, Navigate } from 'react-router-dom'
import LoginPage from '../auth/LoginPage'
import AcceptInvitationPage from '../features/org-structure/pages/AcceptInvitationPage'
import RequireAuth from './RequireAuth'
import AdminLayout from './AdminLayout'
import RouteErrorBoundary from './RouteErrorBoundary'
import CompaniesListPage from '../features/org-structure/pages/CompaniesListPage'
import CompanyDetailPage from '../features/org-structure/pages/CompanyDetailPage'
import UsersListPage from '../features/org-structure/pages/UsersListPage'
import SystemSettingsPage from '../features/org-structure/pages/SystemSettingsPage'

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: '/', element: <Navigate to="/admin/companies" replace /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/accept-invitation/:token', element: <AcceptInvitationPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { path: '/admin/companies', element: <CompaniesListPage /> },
              { path: '/admin/companies/:id', element: <CompanyDetailPage /> },
              { path: '/admin/companies/:companyId/users', element: <UsersListPage /> },
              { path: '/admin/system-settings', element: <SystemSettingsPage /> },
            ],
          },
        ],
      },
    ],
  },
])
