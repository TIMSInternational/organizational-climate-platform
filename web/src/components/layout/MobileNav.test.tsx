import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router'
import { TranslationProvider } from '../../i18n'
import { buildNavSections, type NavSection } from '../../navigation/navSections'
import { MobileNav } from './MobileNav'

afterEach(cleanup)

const COMPANY = 'c1'

/**
 * Mounts the nav under a real router at `initialPath`, with `/other` reachable so
 * a navigation can actually be observed.
 */
function renderNav(sections: NavSection[], initialPath = '/action-plans') {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <>
            <MobileNav sections={sections} footer={<button>Sign out</button>} />
            <Outlet />
          </>
        ),
      },
    ],
    { initialEntries: [initialPath] },
  )
  return render(
    <TranslationProvider>
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

function companyAdminSections() {
  return buildNavSections('company_admin', COMPANY)
}

describe('MobileNav', () => {
  it('renders nothing when there are no sections at all', () => {
    // An empty bar pinned over the bottom of the page would steal 56px for
    // nothing. Passed directly rather than via buildNavSections: since #99 gave
    // every role a Notifications entry, no role produces `[]` any more, but this
    // component must still cope with an empty list.
    const { container } = renderNav([])
    expect(container.querySelector('nav')).toBeNull()
  })

  it('gives a role with no admin pages a bar with their own per-user pages', () => {
    renderNav(buildNavSections('employee', COMPANY))
    const bar = screen.getByRole('navigation')
    // Their home and their assigned surveys (#132, #109): both home rows, so both are tabs.
    // The inbox left the nav for the bell in the top bar (11 Nov).
    const links = within(bar).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/dashboard', '/surveys/my'])
  })

  it('gives each section of the rail one tab, named for the section', () => {
    // The bar is the rail's table of contents (`mobileTabs`): Inicio, then Encuestas,
    // Seguimiento and Analítica, each leading to its section's first page. Taking the first
    // four rows instead would have spent three tabs on Encuestas.
    renderNav(companyAdminSections())
    const bar = screen.getByRole('navigation')
    const links = within(bar).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Home', 'Surveys', 'Follow-up', 'Analytics'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/dashboard',
      '/surveys',
      '/action-plans',
      `/admin/companies/${COMPANY}/analytics`,
    ])
  })

  it('never spends a tab on a group toggle', () => {
    // Preguntas is a disclosure in the sidebar, not a page.
    renderNav(companyAdminSections())
    const bar = screen.getByRole('navigation')
    expect(within(bar).queryByRole('link', { name: 'Questions' })).toBeNull()
    expect(within(bar).queryByRole('button', { name: 'Questions' })).toBeNull()
  })

  it('offers at most four tabs plus More', () => {
    renderNav(companyAdminSections())
    const bar = screen.getByRole('navigation')
    expect(within(bar).getAllByRole('link')).toHaveLength(4)
    expect(within(bar).getByRole('button', { name: 'More' })).toBeTruthy()
  })

  it('marks the tab for the current route as the current page', () => {
    renderNav(companyAdminSections(), '/dashboard')
    const active = screen.getByRole('link', { name: 'Home' })
    expect(active.getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Surveys' }).getAttribute('aria-current')).toBeNull()
  })

  it('marks a section’s tab on every page of that section, and only that tab', () => {
    // Plantillas and the question library have no tab of their own; they are Encuestas.
    for (const path of ['/surveys', '/surveys/templates', '/admin/question-library', '/surveys/abc/results']) {
      cleanup()
      renderNav(companyAdminSections(), path)
      const bar = screen.getByRole('navigation')
      const current = within(bar)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.textContent)
      expect(current, path).toEqual(['Surveys'])
    }
  })

  it('marks no tab where the rail lights no row, and never on a bare prefix', () => {
    for (const path of ['/dev/chart-gallery', '/surveys-archive', '/notifications']) {
      cleanup()
      renderNav(companyAdminSections(), path)
      const bar = screen.getByRole('navigation')
      const current = within(bar)
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
      expect(current, path).toEqual([])
    }
  })

  it('marks only the home row that owns the page, not every home row', () => {
    renderNav(buildNavSections('leader', COMPANY), '/surveys/my')
    const bar = screen.getByRole('navigation')
    expect(within(bar).getByRole('link', { name: 'My Surveys' }).getAttribute('aria-current')).toBe('page')
    expect(within(bar).getByRole('link', { name: 'My Team' }).getAttribute('aria-current')).toBeNull()
  })

  it('inks the tab labels above the AA threshold, and leaves the hue on the icon', () => {
    // Measured in Chrome at 10px on the panel: `--admin-accent-blue` #2E9098 is
    // 3.78:1 and `--admin-font-tertiary` #818181 is 3.90:1, both under WCAG AA's
    // 4.5:1 for text. An *icon* is held to 1.4.11's 3:1 and both clear it, so the
    // colour stays on the row (the icon inherits it) and the label overrides it.
    renderNav(companyAdminSections(), '/dashboard')

    const activeRow = screen.getByRole('link', { name: 'Home' })
    expect(activeRow.className).toContain('text-accent-blue')
    const activeLabel = activeRow.querySelector('span')!
    expect(activeLabel.className).toContain('text-fg-primary')
    expect(activeLabel.className).toContain('font-semibold')

    const inactiveLabel = screen.getByRole('link', { name: 'Surveys' }).querySelector('span')!
    expect(inactiveLabel.className).toContain('text-fg-secondary')
  })

  it('traps focus in the drawer and returns it to the trigger on Escape', async () => {
    // The legacy drawer was a bare `position: fixed` div: no trap, no Escape, and
    // focus stayed on the page behind it. This is the reason it is a Sheet.
    renderNav(companyAdminSections())
    const trigger = screen.getByRole('button', { name: 'More' })
    await userEvent.click(trigger)

    const drawer = await screen.findByRole('dialog')
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true))

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('names the drawer, so it does not announce as an unlabelled dialog', async () => {
    renderNav(companyAdminSections())
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(await screen.findByRole('dialog', { name: 'Menu' })).toBeTruthy()
  })

  it('shows the full role-aware nav in the drawer, including the grouped rows', async () => {
    renderNav(companyAdminSections())
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    const drawer = await screen.findByRole('dialog')

    // Every row the tab bar has no slot for is reachable here, the disclosure included.
    expect(within(drawer).getByRole('button', { name: 'Questions' })).toBeTruthy()
    expect(within(drawer).getByRole('link', { name: 'Microclimates' })).toBeTruthy()
    expect(within(drawer).getByRole('link', { name: 'People' })).toBeTruthy()
  })

  it('carries the shell controls, which the hidden sidebar would otherwise strand', async () => {
    renderNav(companyAdminSections())
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('closes when a drawer link is followed', async () => {
    // Radix has no idea a route changed, so a drawer left open would sit over the
    // page the user just navigated to.
    renderNav(companyAdminSections())
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    const drawer = await screen.findByRole('dialog')
    await userEvent.click(within(drawer).getByRole('link', { name: 'Microclimates' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('is hidden from the md breakpoint up', () => {
    // The desktop sidebar takes over there; both visible at once is two navs.
    renderNav(companyAdminSections())
    expect(screen.getByRole('navigation').className).toContain('md:hidden')
  })
})
