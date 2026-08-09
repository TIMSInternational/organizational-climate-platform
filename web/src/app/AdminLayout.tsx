import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router'
import RoleBasedNav from '../navigation/RoleBasedNav'
import { buildNavSections, withUnreadBadge } from '../navigation/navSections'
import { clearToken, getToken } from '../auth/token'
import { decodeJwtPayload } from '../auth/jwt'
import { useTranslation } from '../i18n'
import { SkipLink } from '../components/ui'
import {
  CommandPalette,
  CompanyContextSwitcher,
  MobileNav,
  SearchTrigger,
  ShellControls,
  SidebarBrand,
  SidebarUserMenu,
} from '../components/layout'
import { CompanyContextProvider, writeSelectedCompanyId } from '../company-context'
import { NotificationBell } from '../features/notifications/components/NotificationBell'

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
  // A thin wrapper so `AdminShell` below keeps its original shape rather than
  // gaining a level of indentation across 120 lines of JSX. #124's provider has to
  // sit outside the whole shell, not just `<main>`: the header's company switcher
  // writes the context and the routed page reads it, so a provider inside the
  // scroll container would put the writer outside the tree of readers.
  return (
    <CompanyContextProvider>
      <AdminShell />
    </CompanyContextProvider>
  )
}

function AdminShell() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  function handleSignOut() {
    clearToken()
    // #124: the company context is a per-*person* choice, and this browser is
    // about to be handed to whoever logs in next. Leaving it behind would greet a
    // second SuperAdmin with the first one's tenant already selected, which is the
    // silent scoping this feature exists to prevent, arrived at from a new angle.
    writeSelectedCompanyId(null)
    navigate('/login')
  }

  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
  // The bell owns the poll; the rail just reads the number it reports, so the two
  // can never disagree and nothing is fetched twice. See `withUnreadBadge` for why
  // Notifications is the only badged row.
  const sections = withUnreadBadge(buildNavSections(role, companyId), unreadCount)

  return (
    <div className="flex h-dvh flex-col bg-surface-outer">
      {/* First focusable thing on the page, so a keyboard user is not made to Tab
          through the whole sidebar on every navigation. `#main` matches the id
          below and is SkipLink's own default. */}
      <SkipLink href="#main">{t('shell.skipToContent')}</SkipLink>

      <div className="flex min-h-0 flex-1">
        <aside
          // Transparent, not a panel. The ForMaps rail has no background of its
          // own -- it sits on the page surface, and only the content column is a
          // card. A filled rail plus a filled content panel reads as two competing
          // surfaces with a seam down the middle.
          className="hidden shrink-0 flex-col overflow-y-auto md:flex"
          style={{
            width: collapsed
              ? 'var(--admin-size-sidebar-collapsed)'
              : 'var(--admin-size-sidebar)',
            transition: 'width var(--admin-duration-base) var(--admin-ease-out)',
          }}
        >
          {/* The rail's head — mark, wordmark, collapse control. The toggle used to
              be a lone right-aligned button floating above the first nav row; it
              moved into `SidebarBrand` because ForMaps' bar holds both, and a rail
              that opens with a bare chevron reads as unfinished chrome rather than
              as the top of an application. */}
          <SidebarBrand collapsed={collapsed} onToggleCollapsed={() => setCollapsed((value) => !value)} />

          <RoleBasedNav sections={sections} collapsed={collapsed} />

          {/* `mt-auto` pins the block to the bottom of the rail. Unlike the
              `ShellControls` it replaced, it renders while collapsed too — the
              avatar alone fits a 52px rail, and clicking it expands rather than
              opening a menu with nowhere to go. `ShellControls` is still what the
              mobile drawer uses, where there is no rail and the controls need to
              be visible rather than behind a menu. */}
          <div className="mt-auto">
            <SidebarUserMenu
              onSignOut={handleSignOut}
              collapsed={collapsed}
              onExpand={() => setCollapsed(false)}
            />
          </div>
        </aside>

        {/* The content column: a fixed header strip over the scrolling `<main>`.
            `min-w-0` sits here, on the flex *child*, so a wide table inside the
            column scrolls rather than stretching the row and pushing the sidebar
            off-screen — it moved out from `<main>` when this wrapper appeared. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* #99 puts the notification bell back in the shell. It is a `<header>`
              outside `<main>` on purpose: the bell is chrome, not page content,
              so the skip link's `#main` target must still skip past it, and the
              bell must not scroll away with the page. `shrink-0` keeps the strip
              from being squeezed by a tall page.

              Deliberately NOT in `PageTopBar`: that is per-page (title,
              breadcrumbs, actions), so a bell there would appear once per page
              that happens to render one and vanish on the pages that do not.
              Deliberately not in `ShellControls` either — that lives in the
              sidebar footer, which is hidden while the rail is collapsed and
              hidden entirely below `md`, which is exactly where an unread badge
              needs to be visible.

              Transparent and unruled, and measured against ForMaps' own top bar
              (`components/layout/PageTopBar.tsx` there): `flex items-center
              justify-end shrink-0`, `minHeight: 40`, `padding: 10px 12px 10px
              16px`, and no background or border at all. It used to be
              `bg-surface-panel` over a `border-b`, which drew a full-width rule
              between the rail and the content card and made the strip read as a
              third surface — rendered in Chrome, the seam was the first thing the
              eye landed on. The bar is chrome floating in the shell's gutter; the
              card below is the only panel. */}
          <header
            className="flex shrink-0 items-center justify-end gap-inline"
            style={{ minHeight: 40, padding: '10px 12px 10px 16px' }}
          >
            {/* #124's company-context selector. Renders `null` for every role but
                SuperAdmin, so the strip is unchanged for everyone else — the bell
                stays flush right and nothing shifts. It is here rather than in
                `ShellControls` for the reason that block is hidden on a collapsed
                rail and below `md`: a global scope switch that disappears while
                the pages it scopes stay visible is worse than none. */}
            <CompanyContextSwitcher />
            {/* ForMaps puts the search glyph and its Cmd+K chip immediately before
                the bell in this same strip, and so does this. It opens the palette
                by dispatching a window event rather than by holding shared state —
                see `CommandPalette.tsx`. */}
            <SearchTrigger />
            <NotificationBell onUnreadCountChange={setUnreadCount} />
          </header>

          {/* The scroll container. */}
          <main id="main" className="min-w-0 flex-1 overflow-y-auto p-gutter">
          {/* Legacy AppShell inset its content by 12px and put it on a panel:
              `background: var(--admin-bg-panel)`, `1px solid
              var(--admin-border-panel)`, `borderRadius: 8`.
              `pb-20 md:pb-panel` clears the mobile tab bar, which is `fixed` and
              would otherwise cover the last ~56px of every page.

              **No width cap, and that is a reversal.** This used to be
              `mx-auto ... max-w-content` (1280px), to stop a full-width control
              growing with the viewport on a large monitor. Measured across eleven
              viewports, that cap did something worse than what it prevented: it
              bites from 1516px up — which is a 1728 MacBook Pro and a 1920 monitor,
              not an exotic size — and because the column starts *after* the 220px
              rail, centring the capped card inside it pushed the card away from the
              rail. At 2560 there were 530px of empty surface between them and at
              3440 there were 970px, so the navigation read as belonging to nothing
              and the page as an island.

              The cap was also aimed at the wrong thing. A table, a chart or a KPI
              row is *better* for having the width; it is prose that becomes
              unreadable, and the same measurement put the empty-state description
              at 132 characters per line where about 70 is the limit. So the
              constraint moved onto the text — `max-w-prose` on the description in
              `PageTopBar` and in `ui/error-state.tsx` — and the container fills,
              which is also what ForMaps' own `AppShell` does (no `maxWidth`
              anywhere in it).

              `--admin-size-content-max` still exists and is still right for its two
              remaining callers, `PublicSurveyRespondPage` and the dev chart
              gallery: both are standalone centred pages with no rail beside them,
              so there is nothing for a centred column to drift away from.

              `overflow-x-auto` was added here as the *table* fix and is no longer
              that. It was measured rather than guessed: index.css used to give
              every `table` `width: 100%` and every `th` `white-space: nowrap`, so a
              table's *min-content* width exceeded the panel on a phone and the
              table rendered up to 150px past the panel's own rounded border and
              background — reachable, because `main`'s `overflow-y: auto` computes
              `overflow-x` to `auto`, but visibly outside the card. Measured in
              Chrome at 320px and 390px on Users, Companies, Action Plans and
              Demographic fields; same class of defect as the #79 HeatMap, and the
              same root cause.

              #218 moved that root cause out of the element layer: `w-full` and the
              nowrap header now live in `ui/table.tsx`, next to the
              `overflow-x-auto` container they need, and every table in the app goes
              through it. The rule is kept here as a *generic* guard, not a
              table-specific workaround — anything too wide (a long pre, a wide
              inline SVG) still scrolls inside the card rather than escaping its
              border. Deliberately not removed: it costs nothing and the failure it
              catches is invisible to happy-dom. */}
            {/* `min-h-full` so the panel is at least as tall as the column it sits
                in. Without it a short page — an empty state, a four-row table —
                rendered as a stub card stranded at the top of a large grey field,
                which reads as content that failed to load rather than as a page
                with little on it. The panel is the page's surface, so it should be
                the height of the page. */}
            <div className="flex min-h-full w-full flex-col overflow-x-auto rounded-xl border border-line-panel bg-surface-panel p-panel pb-20 md:pb-panel">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <MobileNav sections={sections} footer={<ShellControls onSignOut={handleSignOut} />} />

      {/* Last in the shell, outside every column, because it portals to the body
          anyway and its Cmd+K listener is document-wide. Handed the same `sections`
          the rail gets, so it can only ever offer this role's own destinations. */}
      <CommandPalette sections={sections} />
    </div>
  )
}
