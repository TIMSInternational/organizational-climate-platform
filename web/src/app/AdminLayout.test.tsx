import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../i18n'
import { setToken, clearToken } from '../auth/token'
import { ADMIN_THEME_ATTRIBUTE, ADMIN_THEME_STORAGE_KEY } from '../theme/adminTheme'
import AdminLayout from './AdminLayout'

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(ADMIN_THEME_STORAGE_KEY)
  document.documentElement.removeAttribute(ADMIN_THEME_ATTRIBUTE)
})

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

  it('shows no nav rows for a role that has no admin pages', () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderShell()
    expect(screen.queryByRole('button', { name: /Administration/ })).toBeNull()
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

  it('offers the theme control the token layer has always had no UI for', async () => {
    renderShell()
    const picker = screen.getAllByRole('combobox', { name: 'Theme' })[0]
    await userEvent.selectOptions(picker, 'dark')

    expect(document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE)).toBe('dark')
    expect(localStorage.getItem(ADMIN_THEME_STORAGE_KEY)).toBe('dark')
  })
})
