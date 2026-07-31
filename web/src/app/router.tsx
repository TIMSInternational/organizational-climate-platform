import { createBrowserRouter } from 'react-router-dom'
import LoginPage from '../auth/LoginPage'
import RequireAuth from './RequireAuth'
import AdminLayout from './AdminLayout'
import CompaniesListPage from '../features/org-structure/pages/CompaniesListPage'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { path: '/admin/companies', element: <CompaniesListPage /> },
        ],
      },
    ],
  },
])
