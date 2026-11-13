import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import RoleBasedNav from '../navigation/RoleBasedNav'
import { buildNavSections, drawsRespondentShell } from '../navigation/navSections'
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
  CompanyScopeLabel,
  MobileNav,
  SearchTrigger,
  ShellControls,
  PoweredByNexadev,
  SidebarBrand,
  SidebarUserMenu,
} from '../components/layout'
import { CompanyContextProvider, writeSelectedCompanyId } from '../company-context'
import { LogOut } from 'lucide-react'
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
  // `trackingEnabled` is a deployment capability, not company scoping -- the
  // tracking service resolves the tenant from the caller's own claim. See
  // `features/tracking/api/config.ts`. Both callers of `buildNavSections` must pass
  // it or the module's rows silently vanish; `navSections.test.ts` reads this file
  // and PageTopBar.tsx to make sure neither stops asking.
  //
  // No unread badge on a rail row any more: since the 11 Nov regroup Notificaciones is not a
  // rail row. The bell in the top bar owns the poll AND shows the count, on every page and at
  // every width, so the number has exactly one place to be read.
  const sections = buildNavSections(role, companyId, { trackingEnabled: isTrackingEnabled() })

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
  //
  // An EMPLOYEE only, since 2026-11-12: a supervisor's rows are the same per-person pages, but
  // the owner ruled that the role that runs a team keeps the rail. `drawsRespondentShell`
  // carries the exception and the ruling it narrows.
  const perUserOnly = drawsRespondentShell(role, sections)

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
            {/* The builder's credit, under the account. Expanded only: the collapsed rail is
                52px, too narrow for the sentence, and the mark alone would be unexplained. */}
            {collapsed ? null : <PoweredByNexadev className="px-4 pb-3 pt-1" />}
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
            className="on-shell flex shrink-0 items-center"
            // The Apple-design bar (`occ.css` `.bar`): 52px, 8px from the rail and 16px from the
            // window's right edge — the content box below sits 12px in, so the bell's glyph
            // lines up just inside the box's right edge.
            //
            // The RAILLESS shell overrides that to the shell gutter, because its strip has to
            // line up with something the canvas never drew: a CENTRED card. Below, the railless
            // card is `mx-auto max-w-content` inside `p-gutter`, so at 1440 its left edge is
            // 12 + (1416 - 1280) / 2 = 80px, while a 20px strip put the lockup at 20. Sixty
            // pixels out, and read as a logo hanging off the card's edge. Matching the gutter
            // here and capping the row below with the same `max-w-content` makes the two edges
            // one line at EVERY width rather than at one.
            style={{ minHeight: 52, padding: perUserOnly ? '0 var(--spacing-gutter)' : '0 var(--admin-space-16) 0 var(--admin-space-8)' }}
          >
            <div
              className={cn(
                'flex w-full items-center justify-end gap-2.5',
                // Railless only. The rail's card is deliberately flush against the rail's edge
                // and NOT centred -- see the scroll container's note -- so capping its strip
                // would pull the bell in from a card that never moved.
                perUserOnly ? 'mx-auto max-w-content' : null,
              )}
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
              {/* The company — and a leader's department — the rail roles other than the super
                  administrator are scoped to, as the CompanyHome and TeamHome boards print it
                  where the super administrator's selector sits. Not a control: their scope is
                  their own claim and there is nothing to choose. From `GET /profile`, which the
                  shell already reads for the tenant mark, so it costs no request. */}
              {perUserOnly ? null : <CompanyScopeLabel role={role} />}
              {/* ForMaps puts the search glyph and its Cmd+K chip immediately before
                  the bell in this same strip, and so does this. It opens the palette
                  by dispatching a window event rather than by holding shared state —
                  see `CommandPalette.tsx`. */}
              {/* The palette offers this role its own three pages, which are the page it is
                  on. The chip is chrome advertising a shortcut to nowhere. */}
              {perUserOnly ? null : <SearchTrigger />}
              {/* Ruled 2026-10-18, after ESPH read the strip back: a respondent's strip is a
                  wordmark and one exit, and nothing else.

                  The bell is not a notification CENTRE for this role -- it is the last surviving
                  row of the rail the client asked to hide. The rail's own note above already
                  calls Notificaciones "the bell two inches to the right", which is an argument
                  for deleting the row, not for keeping the bell. And its unread badge puts a red
                  count beside a survey someone is being asked to answer this week.

                  For the rail roles the bell is also the way to the inbox: Notificaciones left the
                  rail in the 11 Nov regroup, and the bell's own "Ver todas" links there. */}
              {perUserOnly ? null : <NotificationBell />}
              {perUserOnly ? (
                /* Sign out as plain words, not an avatar. The avatar went with the bell: it is a
                   circular control that LOOKS like an account surface, and "no tenemos el botón
                   de usuario para que puedan revisar su información" was the ruling. What it
                   still owed the respondent is the way OUT, so that is all it is now -- named
                   rather than drawn.

                   ⚠️ Theme and Language went with it; they lived in that menu. The respond screen
                   carries its own Español/Claro pair, which is where a respondent spends the
                   week, and ESPH's company language is `es` for all 642. If they are ever wanted
                   on THIS page they come back as bare chips beside this button, not as a menu
                   behind an avatar. */
                <button
                  type="button"
                  onClick={handleSignOut}
                  // A 32px target on a phone; HIG `buttons.md` asks for 44x44 under a finger, as
                  // every Button size already grows to (12 Nov). `min-height` beats the inline
                  // `height`, so the desktop strip is unchanged.
                  className="pointer-coarse:min-h-11 pointer-coarse:min-w-11 justify-center"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'transparent', border: 0, borderRadius: 6,
                    padding: '6px 8px', height: 32, cursor: 'pointer',
                    color: 'var(--admin-font-secondary)', fontSize: 13, lineHeight: 1,
                  }}
                >
                  <LogOut aria-hidden="true" style={{ width: 15, height: 15, flexShrink: 0 }} />
                  {t('shell.signOut')}
                </button>
              ) : null}
            </div>
          </header>

          {perUserOnly ? (
            /* The railless shell keeps its column as the scroller, with the card centred in
               it: the card is capped at `max-w-content`, so at 1440 there are 80px of navy on
               either side of it, and a scroller confined to the card would leave a wheel over
               those margins doing nothing — on the shell most of a mass-invited workforce uses.
               `p-gutter` on all four sides: with no rail there is no edge to sit against. */
            <main
              id="main"
              className="min-w-0 flex-1 overflow-y-auto p-gutter [scrollbar-gutter:stable]"
            >
              <div className="mx-auto flex min-h-full w-full max-w-content flex-col overflow-x-auto rounded-box bg-surface-panel px-4 pb-20 pt-4.5 md:px-box-x md:pb-box-bottom md:pt-box-top">
                <Outlet />
              </div>
            </main>
          ) : (
            /* The content box, and the scroller: the Apple-design frame (`occ.css` `.page`).

               The box is `<main>` itself and scrolls INSIDE its rounded edge, so the corners and
               the 12px of navy around it stay put while the page moves — the box reads as a
               window onto the page, which is what the boards draw. Until the regroup the navy
               column scrolled and the card rode up under the bar with it.

               Geometry, from `md`: flush against the rail and under the bar (no top or left
               margin), 12px of navy on the right and the bottom (`m-gutter`), radius 14px
               (`rounded-box`), and the boards' 22/28/56px inside (`pt-box-top`, `px-box-x`,
               `pb-box-bottom`). Below `md` there is no rail, so the gutter goes on all four
               sides, the padding steps down to the boards' phone values (18px over 16px sides),
               and `pb-20` clears the fixed tab bar that would otherwise cover the last ~56px.
               No border: the white box on the navy needs none, and the boards draw none.

               `min-w-0` stops a wide child stretching the flex row and pushing the rail off the
               screen; `overflow-y-auto` computes `overflow-x` to auto as well, so anything too
               wide (a long pre, a wide inline SVG) scrolls inside the box rather than escaping
               its rounded edge — `ui/table.tsx` has its own scroller for tables (#218), and this
               is the generic guard behind it, invisible to happy-dom.
               `[scrollbar-gutter:stable]`: a page taller than the box otherwise shifts every
               centred thing in it sideways by the scrollbar's width, and back on the next page.

               No width cap. Centring a capped card beside a rail pushed it away from the rail
               (530px of empty surface between them at 2560); a table or a chart is better for
               the room, and prose carries its own cap (`max-w-measure`). */
            <main
              id="main"
              className="m-gutter min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto rounded-box bg-surface-panel [scrollbar-gutter:stable] md:ml-0 md:mt-0"
            >
              {/* `min-h-full` so a short page — an empty state, a four-row table — still fills
                  the box rather than reading as a stub that failed to load. */}
              <div className="flex min-h-full w-full flex-col px-4 pb-20 pt-4.5 md:px-box-x md:pb-box-bottom md:pt-box-top">
                <Outlet />
              </div>
            </main>
          )}
        </div>
      </div>

      {/* The same argument as the rail, one breakpoint down: five truncated tabs
          ("Panel de Co…", "Mis Encuest…", "Notificacion…", "Más") across the foot of a
          390px screen, all of them this page. Most of a mass-invited workforce answers
          on a phone, so this is the copy of the chrome that matters most. */}
      {perUserOnly ? null : (
        <MobileNav
          sections={sections}
          footer={
            <>
              <ShellControls onSignOut={handleSignOut} />
              <PoweredByNexadev className="pt-2" />
            </>
          }
        />
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
