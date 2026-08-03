import { Outlet } from 'react-router'
import RoleBasedNav from '../navigation/RoleBasedNav'
import { buildNavSections } from '../navigation/navSections'
import { clearToken, getToken } from '../auth/token'
import { decodeJwtPayload } from '../auth/jwt'
import { useNavigate } from 'react-router'
import { useTranslation, LanguageSwitcher } from '../i18n'

export default function AdminLayout() {
  const navigate = useNavigate()
  const { t } = useTranslation()

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
      <aside
        style={{
          width: 'var(--admin-size-sidebar)',
          flexShrink: 0,
          padding: 'var(--admin-size-shell-gutter)',
          background: 'var(--admin-bg-panel)',
          borderRight: '1px solid var(--admin-border-default)',
        }}
      >
        <RoleBasedNav sections={sections} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--admin-size-row-gap)',
            marginTop: 'var(--admin-size-panel-gap)',
          }}
        >
          <LanguageSwitcher />
          <button onClick={handleLogout}>{t('shell.signOut')}</button>
        </div>
      </aside>
      {/* The legacy AppShell inset its content by 12px and put it on a panel:
          `background: var(--admin-bg-panel)`, `1px solid var(--admin-border-panel)`,
          `borderRadius: 8`. `--admin-size-content-max` caps the column so a
          full-width control (a search box, a table) stops growing with the
          viewport on an ultrawide monitor. */}
      <main style={{ flex: 1, minWidth: 0, padding: 'var(--admin-size-shell-gutter)' }}>
        <div
          style={{
            maxWidth: 'var(--admin-size-content-max)',
            margin: '0 auto',
            padding: 'var(--admin-size-panel-padding)',
            background: 'var(--admin-bg-panel)',
            border: '1px solid var(--admin-border-panel)',
            borderRadius: 'var(--admin-radius-xl)',
          }}
        >
          <Outlet />
        </div>
      </main>
    </div>
  )
}
