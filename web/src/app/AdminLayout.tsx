import { Outlet } from 'react-router-dom'
import RoleBasedNav from '../navigation/RoleBasedNav'
import { navSections } from '../navigation/navSections'
import { clearToken } from '../auth/token'
import { useNavigate } from 'react-router-dom'

export default function AdminLayout() {
  const navigate = useNavigate()

  function handleLogout() {
    clearToken()
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 240, borderRight: '1px solid var(--admin-border-default)' }}>
        <RoleBasedNav sections={navSections} />
        <button onClick={handleLogout}>Log out</button>
      </aside>
      <main style={{ flex: 1, padding: 24 }}>
        <Outlet />
      </main>
    </div>
  )
}
