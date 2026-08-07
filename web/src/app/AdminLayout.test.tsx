import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../i18n'
import { setToken, clearToken } from '../auth/token'
import { ADMIN_THEME_ATTRIBUTE, ADMIN_THEME_STORAGE_KEY } from '../theme/adminTheme'
import { COMPANY_CONTEXT_STORAGE_KEY } from '../company-context'
import AdminLayout from './AdminLayout'

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

/** An unsigned JWT carrying just the claims the shell reads. */
function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

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

  it('shows no admin nav rows for a role that has no admin pages', () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderShell()
    expect(screen.queryByRole('button', { name: /Administration/ })).toBeNull()
    // Since #99 this role is no longer given an *empty* nav — it gets the one
    // page it can load, its own inbox.
    expect(screen.getAllByRole('link', { name: 'Notifications' }).length).toBeGreaterThan(0)
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

  it('caps the content column so a table does not stretch across an ultrawide monitor', () => {
    renderShell()
    const panel = document.getElementById('main')!.firstElementChild!
    expect(panel.className).toContain('max-w-content')
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
    expect(panel).toContain('md:pb-panel')
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
