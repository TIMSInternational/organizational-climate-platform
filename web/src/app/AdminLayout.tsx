import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import RoleBasedNav from '../navigation/RoleBasedNav'
import { buildNavSections, isPerUserOnly, withUnreadBadge } from '../navigation/navSections'
import { isTrackingEnabled } from '../features/tracking/api/config'
import { clearToken, getToken } from '../auth/token'
import { decodeJwtPayload } from '../auth/jwt'
import { useTranslation } from '../i18n'
import { cn } from '../lib/cn'
import { SkipLink } from '../components/ui'
import {
  BrandLockup,
  CommandPalette,
  CompanyContextSwitcher,
  CompanyLogo,
  MobileNav,
  SearchTrigger,
  ShellControls,
  SidebarBrand,
  SidebarUserMenu,
} from '../components/layout'
import { CompanyContextProvider, writeSelectedCompanyId } from '../company-context'
import { NotificationBell } from '../features/notifications/components/NotificationBell'
import { useCompanyContext } from '../company-context'
import { useOwnCompanyBrand } from '../company-context/useCompanyName'
import { headerSwitcherStandsDown } from './headerScope'

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
  // `trackingEnabled` is a deployment capability, not company scoping -- the
  // tracking service resolves the tenant from the caller's own claim. See
  // `features/tracking/api/config.ts`. Both callers of `buildNavSections` must pass
  // it or the module's rows silently vanish; `navSections.test.ts` reads this file
  // and PageTopBar.tsx to make sure neither stops asking.
  const sections = withUnreadBadge(
    buildNavSections(role, companyId, { trackingEnabled: isTrackingEnabled() }),
    unreadCount,
  )

  // A rail is worth 236px only when it reaches somewhere the page does not. For a
  // respondent every row in it IS the page they are on -- `/dashboard` is this page,
  // "Mis Encuestas" is the list it already prints, and Notificaciones is the bell two
  // inches to the right. ESPH's rehearsal returned that as its second finding.
  //
  // So those roles get no rail, no mobile tab bar and no command-palette chip, and the
  // three things the rail's footer owned -- the account menu, the theme and language
  // pickers, and SIGN OUT -- move into the strip. That last one is why this is not a
  // `hidden` class on the aside: delete the rail without moving its footer and a
  // respondent has no way to leave.
  const perUserOnly = isPerUserOnly(sections)

  return (
    <div className="flex h-dvh flex-col bg-surface-shell">
      {/* First focusable thing on the page, so a keyboard user is not made to Tab
          through the whole sidebar on every navigation. `#main` matches the id
          below and is SkipLink's own default. */}
      <SkipLink href="#main">{t('shell.skipToContent')}</SkipLink>

      <div className="flex min-h-0 flex-1">
        {perUserOnly ? null : (
        <aside
          // Transparent, not a panel. The ForMaps rail has no background of its
          // own -- it sits on the page surface, and only the content column is a
          // card. A filled rail plus a filled content panel reads as two competing
          // surfaces with a seam down the middle.
          className="on-shell hidden shrink-0 flex-col overflow-y-auto md:flex"
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
        )}

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
            // Still `justify-end`, with the tenant mark below taking `mr-auto` to push
            // itself left. `justify-between` was the obvious spelling and it is WRONG here:
            // `md:hidden` removes the mark from flex layout entirely, so on a desktop strip
            // whose only remaining children are the search glyph and the bell, `between`
            // would strand the glyph at the far left. The canvas draws them flush right.
            className="on-shell flex shrink-0 items-center justify-end gap-inline"
            // The canvas's strip: 52px, 20px in from the edge (every artboard).
            style={{ minHeight: 52, padding: '0 20px' }}
          >
            {/* Railless: the rail's head and its footer both land here. `mr-auto` on the
                lockup pushes everything else right, the way `MobileTenantLogo` does on a
                phone -- see the header's own note on why this is not `justify-between`. */}
            {perUserOnly ? (
              <span className="mr-auto flex items-center gap-inline">
                <BrandLockup size="compact" />
                <RailessTenantLogo />
              </span>
            ) : (
              <MobileTenantLogo />
            )}
            {/* #124's company-context selector. Renders `null` for every role but
                SuperAdmin, so the strip is unchanged for everyone else — the bell
                stays flush right and nothing shifts. It is here rather than in
                `ShellControls` for the reason that block is hidden on a collapsed
                rail and below `md`: a global scope switch that disappears while
                the pages it scopes stay visible is worse than none. */}
            <HeaderCompanySwitcher />
            {/* ForMaps puts the search glyph and its Cmd+K chip immediately before
                the bell in this same strip, and so does this. It opens the palette
                by dispatching a window event rather than by holding shared state —
                see `CommandPalette.tsx`. */}
            {/* The palette offers this role its own three pages, which are the page it is
                on. The chip is chrome advertising a shortcut to nowhere. */}
            {perUserOnly ? null : <SearchTrigger />}
            <NotificationBell onUnreadCountChange={setUnreadCount} />
            {perUserOnly ? (
              <span className="relative">
                <SidebarUserMenu onSignOut={handleSignOut} variant="strip" />
              </span>
            ) : null}
          </header>

          {/* The scroll container. */}
          {/* Flush against the rail and under the bar from `md` — every artboard of the
              10 Sep canvas draws the card at x=236 (the rail's edge) and y=52 (the bar's
              foot), with the 12px gutter only on the right and the bottom. Below `md` the
              rail is gone and the gutter keeps the card off the screen's edge. */}
          {/* `[scrollbar-gutter:stable]`: this is the admin scroller, so a page taller than
              the viewport otherwise shifts every centred thing in it sideways by the
              scrollbar's width, and shifts it back on the next short page. `index.css`
              does the same for the document scroller the auth and respond screens use. */}
          <main
            id="main"
            // `md:pt-0 md:pl-0` is the RAIL's geometry: every artboard of the 10 Sep canvas
            // draws the card flush against the rail's edge and the bar's foot, with the
            // gutter only on the right and the bottom. With no rail there is no edge to sit
            // against, and the card read as shoved into the corner — one gutter on the right,
            // none on the left. So the railless shell keeps `p-gutter` on all four sides.
            className={cn(
              'min-w-0 flex-1 overflow-y-auto p-gutter [scrollbar-gutter:stable]',
              perUserOnly ? null : 'md:pt-0 md:pl-0',
            )}
          >
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
              not an exotic size — and because the column starts *after* the
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
            <div
              className={cn(
                'flex min-h-full w-full flex-col overflow-x-auto rounded-xl border border-line-panel bg-surface-panel px-6 pb-20 pt-5 md:pb-8',
                // The cap this file removed in general, put back for the one shell it is
                // right for. The note above records why it went: the column starts AFTER
                // the rail, so centring a capped card inside it pushed the card away from
                // the rail and left 530px of empty surface between them at 2560.
                //
                // With no rail there is nothing to drift away from, and the opposite
                // defect appears instead — a 1413px card at 1440 with the heading and the
                // prose pinned to its left edge and the right half empty, which is what
                // ESPH read as "no padding on the left".
                perUserOnly ? 'mx-auto max-w-content' : null,
              )}
            >
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      {/* The same argument as the rail, one breakpoint down: five truncated tabs
          ("Panel de Co…", "Mis Encuest…", "Notificacion…", "Más") across the foot of a
          390px screen, all of them this page. Most of a mass-invited workforce answers
          on a phone, so this is the copy of the chrome that matters most. */}
      {perUserOnly ? null : (
        <MobileNav sections={sections} footer={<ShellControls onSignOut={handleSignOut} />} />
      )}

      {/* Last in the shell, outside every column, because it portals to the body
          anyway and its Cmd+K listener is document-wide. Handed the same `sections`
          the rail gets, so it can only ever offer this role's own destinations. */}
      <CommandPalette sections={sections} />
    </div>
  )
}

/**
 * The company's own logo in the header strip, on phones only.
 *
 * Below `md` the rail is gone, so this strip was the only chrome on the screen an employee
 * lands on after signing in — and its left half was empty. That screen is what most of a
 * mass-invited workforce sees first, because they answer on a phone.
 *
 * `md:hidden` rather than a second component: from `md` the rail already opens on
 * `SidebarBrand`, and showing the mark twice on one screen is worse than once.
 *
 * It carries the same guarantee `RespondShell` does, and for the same two reasons.
 * `AdminLayout` renders only inside `RequireAuth` (`router.tsx`), and the value comes from
 * `GET /profile`, which is `RequireAuthorization()` — so there is no path by which a
 * visitor holding a link reaches it. `h-6` keeps a tall logo from growing the 52px strip.
 */
/**
 * The tenant's logo in the RAILLESS strip, at every width.
 *
 * `MobileTenantLogo` below is `md:hidden` because from `md` the rail already opens on
 * `SidebarBrand` and the mark would be drawn twice. With no rail there is no second
 * copy, so the same mark is simply shown — which is also what the respondent's own
 * survey page does (`RespondShell`: the OCC lockup, a hairline, then the company's).
 *
 * Same guarantee as its sibling and for the same two reasons: `AdminLayout` renders only
 * inside `RequireAuth`, and the value comes from `GET /profile`, which is
 * `RequireAuthorization()`. `h-6` keeps a tall logo from growing the 52px strip.
 */
function RailessTenantLogo() {
  const brand = useOwnCompanyBrand(true)
  if (!brand.logoUrl || !brand.companyName) return null

  return (
    <>
      <span aria-hidden="true" className="h-5 w-px bg-line-light" />
      <CompanyLogo src={brand.logoUrl} companyName={brand.companyName} className="h-6 max-w-32" />
    </>
  )
}

function MobileTenantLogo() {
  const brand = useOwnCompanyBrand(true)
  if (!brand.logoUrl || !brand.companyName) return null

  // `mr-auto` is what places it: see the header's own comment on why this is not
  // `justify-between`. `h-6` keeps a tall logo from growing the 52px strip.
  return (
    <CompanyLogo
      src={brand.logoUrl}
      companyName={brand.companyName}
      className="mr-auto h-6 max-w-32 md:hidden"
    />
  )
}

/**
 * #124's header switcher, standing down where the page names its own company — the tenant
 * list and pages, and the platform overview while nothing is chosen (`headerScope.ts`).
 */
function HeaderCompanySwitcher() {
  const { pathname } = useLocation()
  const { selectedCompanyId } = useCompanyContext()
  return headerSwitcherStandsDown(pathname, selectedCompanyId) ? null : <CompanyContextSwitcher />
}
