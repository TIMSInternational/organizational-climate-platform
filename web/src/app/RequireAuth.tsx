import { Navigate, Outlet } from 'react-router'
import { getToken } from '../auth/token'

export default function RequireAuth() {
  return getToken() ? <Outlet /> : <Navigate to="/login" replace />
}
