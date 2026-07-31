import { createBrowserRouter } from 'react-router-dom'
import LoginPage from '../auth/LoginPage'
import RequireAuth from './RequireAuth'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      // Task 5 replaces this placeholder with the real AdminLayout + company routes.
      { path: '/admin/companies', element: <div>Companies (placeholder — Task 5/6)</div> },
    ],
  },
])
