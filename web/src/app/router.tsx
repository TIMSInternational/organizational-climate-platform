import { createBrowserRouter } from 'react-router-dom'
import LoginPage from '../auth/LoginPage'
import RequireAuth from './RequireAuth'
import AdminLayout from './AdminLayout'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          // Task 6/7 add the real CompaniesListPage/CompanyDetailPage routes here.
          { path: '/admin/companies', element: <div>Companies list (Task 6)</div> },
        ],
      },
    ],
  },
])
