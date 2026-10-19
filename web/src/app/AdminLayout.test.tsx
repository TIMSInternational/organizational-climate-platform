import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../i18n'
import { setToken, clearToken } from '../auth/token'
import { clearCompanyNameCache } from '../company-context/useCompanyName'
import { ADMIN_THEME_ATTRIBUTE, ADMIN_THEME_STORAGE_KEY } from '../theme/adminTheme'
import { COMPANY_CONTEXT_STORAGE_KEY } from '../company-context'
import AdminLayout from './AdminLayout'
import { tokenFor } from '../test/jwtFixture'

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(ADMIN_THEME_STORAGE_KEY)
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  document.documentElement.removeAttribute(ADMIN_THEME_ATTRIBUTE)
  vi.restoreAllMocks()
})

/**
 * The shell now mounts the #99 notification bell, which polls on mount. Stubbed
 * for every test in this file so the shell's own assertions are not racing a real
 * network call.
 */
function stubUnread(count: number): void {
  const notifications = Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    userId: 'u1',
    companyId: 'c1',
    type: 'survey_invitation',
    channel: 'in_app',
    priority: 'medium',
    status: 'sent',
    title: `Notification ${index}`,
    message: 'body',
    data: null,
    templateId: null,
    scheduledFor: '2026-08-01T09:00:00Z',
    sentAt: '2026-08-01T09:00:01Z',
    deliveredAt: null,
    openedAt: null,
    failedAt: null,
    failureReason: null,
    retryCount: 0,
    createdAt: '2026-08-01T09:00:00Z',
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ notifications }), { status: 200 })),
  )
}

/**
 * The bell's poll plus the company list #124's switcher fetches for a super_admin.
 *
 * Hoisted out of the company-context block below because the entry-point tests at the foot of
 * this file render the shell for every role, and a super_admin whose `/admin/companies` call
 * comes back shaped like a notifications page is a banner over the shell rather than the shell.
 */
function stubShellFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes('/admin/companies')
        ? { companies: [{ id: 'co-a', name: 'Acme Holdings', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-01-01T00:00:00Z' }] }
        : { notifications: [] }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    }),
  )
}

/** An unsigned JWT carrying just the claims the shell reads. */

function renderShell(initialPath = '/action-plans') {
  const router = createMemoryRouter(
    [
      {
        element: <AdminLayout />,
        children: [
          { path: '/action-plans', element: <p>plans page</p> },
          { path: '/microclimates', element: <p>microclimates page</p> },
          { path: '/login', element: <p>login page</p> },
        ],
      },
      { path: '/login', element: <p>login page</p> },
    ],
    { initialEntries: [initialPath] },
  )
  return render(
    <TranslationProvider>
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

describe('AdminLayout', () => {
  beforeEach(() => {
    setToken(tokenFor({ role: 'company_admin', companyId: 'c1' }))
    stubUnread(0)
  })

  it('renders the routed page inside a landmark the skip link can reach', () => {
    renderShell()
    const main = document.getElementById('main')
    expect(main).not.toBeNull()
    expect(main!.tagName).toBe('MAIN')
    expect(within(main!).getByText('plans page')).toBeTruthy()

    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(skip.getAttribute('href')).toBe('#main')
  })

  it('sets the content card flush on the rail and under the bar from md, as the canvas draws it', () => {
    // Every artboard of the 10 Sep canvas draws the card at x=236 (the rail's edge) and
    // y=52 (the bar's foot), with the 12px gutter on the right and the bottom only. The
    // suite has no layout engine, so this pins the classes that place it; the shots
    // measure the pixels (`npm run shot`).
    renderShell()
    const classes = document.getElementById('main')!.className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['p-gutter', 'md:pt-0', 'md:pl-0']))
  })

  it('puts the skip link before the navigation in DOM order', () => {
    // A skip link that comes after the sidebar it exists to skip is decoration.
    renderShell()
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    const nav = screen.getAllByRole('navigation')[0]
    expect(skip.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('builds the sidebar from the JWT claims, not from an env var', () => {
    renderShell()
    // company_admin's group is keyed off the companyId claim.
    expect(screen.getByRole('button', { name: /Company Administration/ })).toBeTruthy()
  })

  it('gives a role with no admin pages no navigation chrome at all', () => {
    // This used to assert the opposite half: no admin rows, but its own inbox row
    // PRESENT in the rail. `isPerUserOnly` removed the rail from under that row, and the
    // reason is the row itself — every destination it offered was the page it was on.
    // ESPH's rehearsal: "al ser un sistema nuevo y la gente no saber usarlo van a
    // consultar mucho referente a como ingresar en la encuesta".
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderShell()

    expect(screen.queryByRole('button', { name: /Administration/ })).toBeNull()
    // No rail, and no mobile tab bar either: the bar is the same chrome one breakpoint
    // down, so leaving it would move the problem to the screen most people answer on.
    expect(screen.queryByRole('link', { name: 'Notifications' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
    // The palette's chip advertises a shortcut to this role's own three pages.
    expect(screen.queryByRole('button', { name: /Search/i })).toBeNull()
  })

  it('keeps the rail for a role that can reach somewhere the page is not', () => {
    // The other side of the same rule, so `isPerUserOnly` cannot be made to return true
    // for everyone without this failing. `leader` has pages of its own.
    setToken(tokenFor({ role: 'leader', companyId: 'c1' }))
    renderShell()

    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy()
  })

  it('collapses and expands the sidebar, and says which it will do', async () => {
    renderShell()
    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')

    await userEvent.click(collapse)

    const expand = screen.getByRole('button', { name: 'Expand sidebar' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
  })

  it('hides the row labels while collapsed but keeps every row reachable by name', async () => {
    renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    // The group row becomes a plain link while collapsed (there is nowhere to
    // draw the sub-tree), so its label has to come from aria-label.
    const row = screen.getByRole('link', { name: 'Company Administration' })
    expect(row.textContent).toBe('')
    expect(row.getAttribute('title')).toBe('Company Administration')
  })

  it('signs out to the login page and drops the token', async () => {
    renderShell()
    await userEvent.click(screen.getAllByRole('button', { name: /Sign out/ })[0])
    await waitFor(() => expect(screen.getByText('login page')).toBeTruthy())
    expect(localStorage.getItem('climate_platform_token')).toBeNull()
  })

  /**
   * The reverse of what this used to assert, and the reason is measured.
   *
   * The panel was `mx-auto max-w-content` (1280px). Because the content column
   * starts *after* the 220px rail, centring a capped card inside it walks the card
   * away from the rail as the viewport grows: measured in Chrome, 210px of empty
   * surface between them at 1920, 530px at 2560, 970px at 3440. The cap also bit
   * from 1516px up, which is an ordinary laptop.
   *
   * A table or a chart is better for the width; it is prose that becomes
   * unreadable, so the cap moved onto the text (`max-w-prose`, asserted below and
   * in `PageTopBar`). happy-dom computes no layout, so — as with the
   * `overflow-x-auto` rule beneath — this can only be asserted as the classes.
   */
  it('does not cap or centre the panel, so the card cannot drift away from the rail', () => {
    renderShell()
    const panel = document.getElementById('main')!.firstElementChild!
    expect(panel.className).not.toContain('max-w-content')
    expect(panel.className).not.toContain('mx-auto')
    expect(panel.className).toContain('w-full')
  })

  it('scrolls a too-wide table inside the panel rather than outside its border', () => {
    // Measured in Chrome, not inferred: index.css gives `table { width: 100% }`
    // and `th { white-space: nowrap }`, so a table's min-content width exceeds the
    // panel at 320-390px and rendered up to 150px past the panel's own rounded
    // border. happy-dom computes no layout, so this can only be asserted as the
    // class that fixes it.
    renderShell()
    expect(document.getElementById('main')!.firstElementChild!.className).toContain('overflow-x-auto')
  })

  it('clears the fixed mobile tab bar below md, and reclaims the space above it', () => {
    renderShell()
    const panel = document.getElementById('main')!.firstElementChild!.className
    expect(panel).toContain('pb-20')
    // From md up, the canvas's 32px under the content (`padding: 20px 24px 32px` on
    // every artboard's content card).
    expect(panel).toContain('md:pb-8')
  })

  it('scrolls the content column rather than the page, so the sidebar stays put', () => {
    renderShell()
    expect(document.getElementById('main')!.className).toContain('overflow-y-auto')
    // `min-w-0` is what stops a wide child stretching the flex row and pushing
    // the sidebar off-screen instead of scrolling inside this column.
    expect(document.getElementById('main')!.className).toContain('min-w-0')
  })

  it('renders exactly one shell implementation: one main, and the sidebar hidden below md', () => {
    renderShell()
    expect(document.querySelectorAll('main')).toHaveLength(1)
    const aside = document.querySelector('aside')!
    expect(aside.className).toContain('hidden')
    expect(aside.className).toContain('md:flex')
  })

  /**
   * #99 puts the notification bell back in the shell.
   *
   * Not into `PageTopBar`: despite the name, the current `PageTopBar` is the port
   * of the legacy `Navbar.tsx` (title / breadcrumbs / actions) and is rendered
   * *by a page*, so a bell there would appear only on pages that happen to render
   * one. The legacy 19-line `layout/PageTopBar.tsx` that did render a bell is the
   * component #80 deliberately did not port, for want of a data source.
   */
  describe('the notification bell', () => {
    it('renders in the shell, so it is on every page rather than per page', async () => {
      renderShell()
      expect(await screen.findByRole('button', { name: /^Notifications/ })).toBeTruthy()
    })

    it('carries the unread count in its accessible name', async () => {
      stubUnread(3)
      renderShell()
      expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeTruthy()
    })

    it('sits in a header outside main, so the skip link still skips it', async () => {
      // `#main` is the skip target. A bell inside it would be the first thing a
      // keyboard user landed on after choosing to skip the chrome.
      renderShell()
      const bell = await screen.findByRole('button', { name: /^Notifications/ })
      const main = document.getElementById('main')!
      expect(main.contains(bell)).toBe(false)
      expect(bell.closest('header')).not.toBeNull()
    })

    it('is reachable by keyboard, after the skip link and the sidebar', async () => {
      // #80 shipped a grouped nav row whose chevron was unreachable by keyboard
      // entirely. Focus order is asserted, not assumed.
      renderShell()
      const bell = await screen.findByRole('button', { name: /^Notifications/ })
      const skip = screen.getByRole('link', { name: 'Skip to content' })
      expect(skip.compareDocumentPosition(bell) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      bell.focus()
      expect(document.activeElement).toBe(bell)
    })

    it('stays visible when the sidebar is collapsed, unlike the sidebar-footer controls', async () => {
      // The theme/language/sign-out block is hidden on a collapsed rail. An
      // unread badge that disappears with it would be worse than no badge.
      stubUnread(2)
      renderShell()
      await screen.findByRole('button', { name: 'Notifications, 2 unread' })
      await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
      expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeTruthy()
    })
  })

  /**
   * #124's company-context selector, asserted from the shell rather than from the
   * component, because "it is on every page" is a property of where it is mounted.
   */
  describe('the company-context selector', () => {
    it('is in the shell header for a super_admin, so it is legible from every page', async () => {
      setToken(tokenFor({ role: 'super_admin', companyId: '' }))
      stubShellFetch()
      renderShell()

      const picker = await screen.findByRole('combobox', { name: 'Company context' })
      // Chrome, not page content: outside `#main` so the skip link still skips it,
      // and in the same strip as the bell so it survives a collapsed rail and the
      // sub-`md` layout where the sidebar footer is gone entirely.
      expect(document.getElementById('main')!.contains(picker)).toBe(false)
      expect(picker.closest('header')).not.toBeNull()
    })

    it('stays visible when the sidebar is collapsed', async () => {
      setToken(tokenFor({ role: 'super_admin', companyId: '' }))
      stubShellFetch()
      renderShell()

      await screen.findByRole('combobox', { name: 'Company context' })
      await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
      expect(screen.getByRole('combobox', { name: 'Company context' })).toBeTruthy()
    })

    it('is absent for a company_admin, whose scope is their own claim', () => {
      // The default token for this file is already company_admin.
      renderShell()
      expect(screen.queryByRole('combobox', { name: 'Company context' })).toBeNull()
    })

    it('drops the selection on sign out, so the next person does not inherit it', async () => {
      localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'co-a')
      setToken(tokenFor({ role: 'super_admin', companyId: '' }))
      stubShellFetch()
      renderShell()

      await screen.findByRole('combobox', { name: 'Company context' })
      await userEvent.click(screen.getAllByRole('button', { name: /Sign out/ })[0])
      await waitFor(() => expect(screen.getByText('login page')).toBeTruthy())
      expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBeNull()
    })
  })

  /**
   * #137's first acceptance criterion is that the privacy page is "reachable by every role",
   * and reachability has two ends. `router.test.ts` holds the routing end — `/settings/privacy`
   * carries no role gate — and `SubjectAccessWireShapeTests.Any_role_can_ask_what_is_held_about_itself`
   * holds the API end. This is the third: **the affordance**. A route nothing links to is
   * reachable only by someone who already knows the URL, which is nobody.
   *
   * That end had no gate at all. Both links could be deleted with the whole tree green: the
   * page is deliberately not in `navSections` (that module is role-aware and would hide a
   * person's own privacy page from the employees whose data it is about), so no navigation test
   * saw them, and the components they live in had no test file of their own.
   *
   * Two entry points, therefore two tests rather than one that either satisfies — deleting
   * either link must turn something red on its own. The desktop rail's account menu is one; the
   * mobile drawer, where the sidebar does not exist below `md`, is the other. Both are asserted
   * for all five roles, because "every role" is the criterion and neither component's contents
   * are role-aware today — a fact worth pinning rather than assuming.
   */
  describe('the way to the privacy page', () => {
    /** The roles that still have a rail, and therefore a mobile drawer under it. */
    const RAIL_ROLES = ['super_admin', 'company_admin', 'leader'] as const
    /** The roles `isPerUserOnly` strips the chrome from. */
    const PER_USER_ROLES = ['supervisor', 'employee'] as const

    beforeEach(stubShellFetch)

    it.each(RAIL_ROLES)('is in the account menu for %s', async (role) => {
      setToken(tokenFor({ role, companyId: 'c1' }))
      renderShell()

      await userEvent.click(screen.getAllByRole('button', { name: /Account/i })[0])

      const menu = await screen.findByRole('menu')
      expect(within(menu).getByRole('menuitem', { name: 'Privacy' }).getAttribute('href')).toBe(
        '/settings/privacy',
      )
    })

    it.each(RAIL_ROLES)('is in the mobile drawer for %s', async (role) => {
      // Below `md` the sidebar — and with it the account menu above — is `hidden`
      // entirely, so on a phone the drawer is the only way to this page.
      //
      // RAIL_ROLES only, since `isPerUserOnly`: a respondent has no drawer because it
      // has no tab bar to open one from. That is not a hole in the guarantee — the test
      // below covers those two roles, and the account button it uses is in the strip at
      // EVERY width, which is one affordance where the rail needed two.
      setToken(tokenFor({ role, companyId: 'c1' }))
      renderShell()

      await userEvent.click(screen.getByRole('button', { name: 'More' }))

      const drawer = await screen.findByRole('dialog')
      expect(within(drawer).getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe(
        '/settings/privacy',
      )
    })

    it.each(PER_USER_ROLES)(
      'offers %s neither their profile page nor the notification settings',
      async (role) => {
        // Findings 3 and 4 of ESPH's rehearsal, which are one surface rather than two.
        //
        // `/profile` prints the respondent's own Nombre completo, Rol, Empresa and
        // Departamento under copy reading "así te ven en la bitácora de cada plan y en lo
        // que creas" — read, reasonably, as the platform saying their name is attached to
        // what they do. `/settings/notifications` offers them "Correos de planes de acción
        // — Asignaciones y avances de los planes de acción", which is the "asociado al
        // sistema de seguimiento" the reviewer could not place: it is the action-plan
        // module, and a respondent is assigned no action plans.
        //
        // Both routes still exist. What is gone is the invitation to wander into them in
        // the middle of a survey, which is the whole of what was reported.
        //
        // Asserted against the WHOLE shell rather than inside a menu, because since the
        // evening of 2026-10-18 there is no menu to look in: the strip is the wordmark
        // and Cerrar sesión. A query scoped to a control that no longer exists would
        // pass for the wrong reason, which is the failure mode this file has hit before.
        setToken(tokenFor({ role, companyId: 'c1' }))
        renderShell()

        expect(screen.queryByRole('button', { name: /Account/i })).toBeNull()
        const hrefs = screen.queryAllByRole('link').map((a) => a.getAttribute('href'))
        expect(hrefs).not.toContain('/profile')
        expect(hrefs).not.toContain('/settings/notifications')
      },
    )

    it.each(RAIL_ROLES)('still offers %s their profile, since it is an admin page', async (role) => {
      // The other side, so "hide it from everyone" cannot pass. An administrator's name
      // really does appear in an audit trail, which is what that page is for.
      setToken(tokenFor({ role, companyId: 'c1' }))
      renderShell()

      await userEvent.click(screen.getAllByRole('button', { name: /Account/i })[0])
      const menu = await screen.findByRole('menu')

      expect(within(menu).getByRole('menuitem', { name: /profile/i }).getAttribute('href')).toBe(
        '/profile',
      )
    })

    it.each(PER_USER_ROLES)('is DELIBERATELY not offered to %s — ruled 2026-10-18', async (role) => {
      // **This reverses the guarantee above for two roles, and the reversal is the point
      // of the test rather than a gap in it.**
      //
      // What the page does to a respondent, measured by rendering it as one: it opens on
      // "Qué se guarda sobre ti" and states, in a table, that "tus respuestas... llevan tu
      // identificador" and "tus datos demográficos... llevan tu identificador", then
      // prints their Nombre and Correo at the foot. Every word is true — ESPH's surveys
      // are identified so the server can enforce one response per person — and ESPH's
      // reviewer, reading it the day before launch, wrote: "entonces mi información sí es
      // guardada, no está siendo anónima, entonces no voy a contestar."
      //
      // The right is not removed; the LINK is. And the product already routes the other
      // half of the same right through an administrator — that page's own words: "el
      // borrado no es un botón de esta página... lo pides tú; lo ejecuta quien administra
      // tu organización". Access now travels the same path, which is consistent.
      //
      // The three admin roles keep both affordances, asserted above, because the argument
      // in this block's docstring still holds for everyone who is not being asked to
      // answer a climate survey this week.
      setToken(tokenFor({ role, companyId: 'c1' }))
      renderShell()

      expect(screen.queryByRole('button', { name: 'More' })).toBeNull()

      // **Extended the same evening, after ESPH read the strip back.** The account menu
      // itself is gone, not just its Privacy row: "no tenemos el botón de usuario para
      // que puedan revisar su información" is satisfied by a control that cannot be
      // mistaken for an account surface, and an avatar is exactly that. The BELL went
      // with it — it was the last surviving row of the rail this block removed, and its
      // unread badge put a red count beside a survey someone is being asked to answer.
      expect(screen.queryByRole('button', { name: /Account/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /Notifications/i })).toBeNull()

      const hrefs = screen.queryAllByRole('link').map((a) => a.getAttribute('href'))
      expect(hrefs).not.toContain('/settings/privacy')

      // What a respondent is left with, and all they need: the way out, named rather
      // than drawn. Sign out is the whole reason any of this followed the rail into the
      // strip, so it is the one thing that must survive every cull.
      expect(screen.getByRole('button', { name: /Sign out/i })).toBeTruthy()
    })

    it.each(RAIL_ROLES)('keeps the notification bell for %s', async (role) => {
      // The other side of the cull, so "remove the bell" cannot quietly become "remove
      // the bell for everyone". An administrator's notifications are a real inbox for
      // rows a respondent never has: action plans, imports, delivery reports.
      setToken(tokenFor({ role, companyId: 'c1' }))
      renderShell()

      expect(screen.getByRole('button', { name: /Notifications/i })).toBeTruthy()
    })
  })

  it('offers the theme control the token layer has always had no UI for', async () => {
    renderShell()

    // Reached through the sidebar's user menu now, not a `<select>` in the rail.
    // The ForMaps port moved language and theme behind the account button: two
    // captioned selects did not fit a 220px column and turned the foot of the
    // navigation into a settings form. The assertion is unchanged -- what the
    // control writes is what matters -- only the route to it.
    await userEvent.click(screen.getAllByRole('button', { name: /Ana|Account/i })[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: /Theme/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Dark/ }))

    expect(document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE)).toBe('dark')
    expect(localStorage.getItem(ADMIN_THEME_STORAGE_KEY)).toBe('dark')
  })
})

/**
 * The tenant's mark in the header strip, which below `md` is the only chrome on the screen
 * an employee lands on after signing in. Its left half used to be empty, and that screen is
 * what most of a mass-invited workforce sees first because they answer on a phone.
 *
 * These stub `/profile` so the logo is genuinely reachable — the negative cases are
 * worthless otherwise, which is the trap `RespondShell.test.tsx` was rewritten for.
 */
describe('the tenant logo in the header strip', () => {
  const LOGO = '/brand/esph-logo.png'

  function serveProfile(logoUrl: string | null) {
    // BEFORE anything renders. `useCompanyName`'s cache is module-level and keyed by the
    // TOKEN, and every test in this file signs in with the same claims — so an earlier test
    // that rendered with no fetch stub has already cached a resolved `null` for this key,
    // and without this the first test here reads that instead of the stub. Clearing it in
    // `afterEach` alone is not enough: the pollution arrives from outside this describe.
    clearCompanyNameCache()
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith('/profile')
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  id: 'u1', companyId: 'c1', companyName: 'ESPH', email: 'a@esph-sa.com',
                  name: 'Ana', role: 'employee', departmentId: null, departmentName: null,
                  managerId: null, isActive: true, hasPassword: true, lastLoginAt: null,
                  createdAt: '2026-01-01T00:00:00Z', demographics: {}, companyLogoUrl: logoUrl,
                }),
                { status: 200 },
              ),
            )
          : Promise.resolve(new Response('{}', { status: 200 })),
      ),
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    clearCompanyNameCache()
  })

  const logo = () => document.querySelector('[data-slot="company-logo"]')

  it('shows the signed-in person their own company mark', async () => {
    serveProfile(LOGO)
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderShell()

    await waitFor(() => expect(logo()).not.toBeNull())
    expect(logo()!.getAttribute('src')).toBe(LOGO)
  })

  it('hides it from `md` up when there IS a rail, which already opens on the lockup', async () => {
    // Showing the mark twice on one screen is worse than once. Asserted on the class
    // because the suite has no layout engine and cannot see a breakpoint apply.
    //
    // `leader`, not `employee`: since `isPerUserOnly` a respondent has no rail, so there
    // is no second copy to avoid and the mark shows at every width. That case is the
    // next test — this one would otherwise have been quietly retargeted at a shell that
    // no longer exists for the role it names.
    serveProfile(LOGO)
    setToken(tokenFor({ role: 'leader', companyId: 'c1' }))
    renderShell()

    await waitFor(() => expect(logo()).not.toBeNull())
    expect(logo()!.className).toContain('md:hidden')
    // `mr-auto` is what places it left while the header stays `justify-end`. With
    // `justify-between` instead, `md:hidden` would strand the search glyph at the far
    // left of every desktop strip — see the header's own comment.
    expect(logo()!.className).toContain('mr-auto')
  })

  it('shows it at every width when there is no rail to show it twice', async () => {
    serveProfile(LOGO)
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderShell()

    await waitFor(() => expect(logo()).not.toBeNull())
    expect(logo()!.className).not.toContain('md:hidden')
  })

  it('renders nothing when the company has no logo', async () => {
    serveProfile(null)
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderShell()

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(logo()).toBeNull()
  })
})
