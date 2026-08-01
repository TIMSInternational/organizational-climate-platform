import { Outlet } from 'react-router-dom'
import RoleBasedNav from '../navigation/RoleBasedNav'
import { buildNavSections } from '../navigation/navSections'
import { clearToken, getToken } from '../auth/token'
import { decodeJwtPayload } from '../auth/jwt'
import { useNavigate } from 'react-router-dom'

export default function AdminLayout() {
  const navigate = useNavigate()

  function handleLogout() {
    clearToken()
    navigate('/login')
  }

  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
  const sections = buildNavSections(role, companyId)

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 240, borderRight: '1px solid var(--admin-border-default)' }}>
        <RoleBasedNav sections={sections} />
        <button onClick={handleLogout}>Log out</button>
      </aside>
      <main style={{ flex: 1, padding: 24 }}>
        <Outlet />
      </main>
    </div>
  )
}
