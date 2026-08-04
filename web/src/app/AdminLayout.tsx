import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import RoleBasedNav from '../navigation/RoleBasedNav'
import { buildNavSections } from '../navigation/navSections'
import { clearToken, getToken } from '../auth/token'
import { decodeJwtPayload } from '../auth/jwt'
import { useTranslation } from '../i18n'
import { SkipLink } from '../components/ui'
import { MobileNav, ShellControls } from '../components/layout'

/**
 * The app shell: sidebar, mobile navigation, and the scrolling content column.
 *
 * This is the one shell implementation (#80). It absorbed the legacy
 * `AppShell`/`DashboardLayout`/`Sidebar` trio rather than porting them as three
 * more wrappers — see `components/layout/index.ts` for what happened to each.
 *
 * ## Responsive behaviour
 *
 * The sidebar is `hidden md:flex`. Below `md` it is gone entirely and
 * `MobileNav` takes over with a bottom tab bar plus a drawer; the shell controls
 * (language, theme, sign out) are handed to the drawer, because the sidebar
 * footer they live in on desktop is not rendered there.
 *
 * `h-dvh` + a scrolling `<main>`, rather than a tall page scrolling as a whole:
 * the sidebar has to stay put while content scrolls, and `dvh` rather than `vh`
 * so the mobile URL bar collapsing does not leave the tab bar off-screen.
 */
export default function AdminLayout() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)

  function handleSignOut() {
    clearToken()
    navigate('/login')
  }

  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
  const sections = buildNavSections(role, companyId)

  return (
    <div className="flex h-dvh flex-col bg-surface-outer">
      {/* First focusable thing on the page, so a keyboard user is not made to Tab
          through the whole sidebar on every navigation. `#main` matches the id
          below and is SkipLink's own default. */}
      <SkipLink href="#main">{t('shell.skipToContent')}</SkipLink>

      <div className="flex min-h-0 flex-1">
        <aside
          className="hidden shrink-0 flex-col overflow-y-auto border-r border-line-default bg-surface-panel p-gutter md:flex"
          style={{
            width: collapsed
              ? 'var(--admin-size-sidebar-collapsed)'
              : 'var(--admin-size-sidebar)',
            transition: 'width var(--admin-duration-base) var(--admin-ease-out)',
          }}
        >
          <div className={collapsed ? 'flex justify-center' : 'flex justify-end'}>
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
              title={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
              className="size-control-md justify-center rounded-md border-none bg-transparent p-0 text-fg-tertiary hover:bg-state-hover"
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden="true" className="size-icon" />
              ) : (
                <PanelLeftClose aria-hidden="true" className="size-icon" />
              )}
            </button>
          </div>

          <RoleBasedNav sections={sections} collapsed={collapsed} />

          {/* `mt-auto` pins the controls to the bottom of the rail, as the legacy
              Sidebar's user block was. Hidden while collapsed: a 52px rail cannot
              hold a `<select>`, and the legacy rail hid them too. */}
          {!collapsed && (
            <div className="mt-auto">
              <ShellControls onSignOut={handleSignOut} />
            </div>
          )}
        </aside>

        {/* The scroll container. `min-w-0` so a wide child (a table, a chart)
            scrolls inside this column instead of stretching the flex row and
            pushing the sidebar off-screen. */}
        <main id="main" className="min-w-0 flex-1 overflow-y-auto p-gutter">
          {/* Legacy AppShell inset its content by 12px and put it on a panel:
              `background: var(--admin-bg-panel)`, `1px solid
              var(--admin-border-panel)`, `borderRadius: 8`.
              `--admin-size-content-max` caps the column so a full-width control (a
              search box, a table) stops growing with the viewport on an ultrawide
              monitor. `pb-20 md:pb-panel` clears the mobile tab bar, which is
              `fixed` and would otherwise cover the last ~56px of every page.

              `overflow-x-auto` is load-bearing, and measured rather than guessed:
              index.css gives every `table` `width: 100%` and every `th`
              `white-space: nowrap`, so a table's *min-content* width exceeds the
              panel on a phone. With the panel at `overflow-x: visible` the table
              rendered up to 150px past the panel's own rounded border and
              background — reachable, because `main`'s `overflow-y: auto` computes
              `overflow-x` to `auto`, but visibly outside the card. Measured in
              Chrome at 320px and 390px on Users, Companies, Action Plans and
              Demographic fields. Scoping the scroll to the panel keeps the frame
              intact. Same class of defect as the #79 HeatMap, and the same root
              cause: the global `table { width: 100% }`. */}
          <div className="mx-auto w-full max-w-content overflow-x-auto rounded-xl border border-line-panel bg-surface-panel p-panel pb-20 md:pb-panel">
            <Outlet />
          </div>
        </main>
      </div>

      <MobileNav sections={sections} footer={<ShellControls onSignOut={handleSignOut} />} />
    </div>
  )
}
