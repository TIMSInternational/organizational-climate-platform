import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../i18n'
import { clearToken, setToken } from '../auth/token'
import { COMPANY_CONTEXT_STORAGE_KEY } from '../company-context'
import { buildNavSections } from '../navigation/navSections'
import { expectNoAxeViolations } from '../test/a11y'
import AdminLayout from './AdminLayout'
import { tokenFor } from '../test/jwtFixture'

/**
 * The keyboard-only walkthrough of the application shell, in Spanish, with both
 * rail modes (#83).
 *
 * ## Why the shell and not each of the twelve pages
 *
 * #83 asks for a keyboard-only pass over the existing pages. Every one of them is
 * rendered *inside* this shell, and the shell is what stands between a keyboard
 * user and the page: the rail, the top strip, and the skip link that exists to get
 * past them. A page whose own controls are the `ui/` primitives — which
 * `components/ui/a11y.axe.test.tsx` sweeps one by one — is reachable exactly when
 * the shell lets Tab reach it. So the walkthrough is: can a keyboard user get from
 * the top of the document into the routed page, and can they reach every
 * destination in the rail, in both rail modes.
 *
 * ## The collapsed rail is the interesting half
 *
 * #83's last scope line is "ensure the sidebar's collapsed mode is operable, not
 * just visible", and that is not rhetorical: at 52px a row shows an icon and no
 * text, so its accessible name has nowhere to come from but `aria-label`, and a
 * grouped row's children are not rendered in the rail at all — they live in a
 * flyout that only exists while the row has hover or focus. A rail that *looks*
 * complete while three destinations are unreachable by keyboard is precisely the
 * defect that is invisible to a screenshot and to every other test in this repo.
 */

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  vi.restoreAllMocks()
})

/** An unsigned JWT carrying just the claims the shell reads. */

function renderShell() {
  const router = createMemoryRouter(
    [
      {
        element: <AdminLayout />,
        children: [
          { path: '/action-plans', element: <p>página de planes</p> },
          { path: '/login', element: <p>inicio de sesión</p> },
        ],
      },
      { path: '/login', element: <p>inicio de sesión</p> },
    ],
    { initialEntries: ['/action-plans'] },
  )
  return render(
    <TranslationProvider initialLocale="es">
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

const COMPANY_ID = '11111111-1111-1111-1111-111111111111'

/**
 * The desktop rail.
 *
 * Every rail assertion is scoped to it, because `MobileNav` renders a SECOND
 * navigation into the same document — hidden by `md:hidden`, a class happy-dom has
 * no layout engine to honour. A document-wide `querySelector` would happily read
 * the phone bar and report the rail as working.
 */
function railElement(): HTMLElement {
  const rail = document.querySelector('aside')
  expect(rail, 'the shell rendered no <aside> rail').not.toBeNull()
  return rail as HTMLElement
}

/** The one nav item with children — the group whose flyout the collapsed rail needs. */
function groupItem() {
  const item = buildNavSections('company_admin', COMPANY_ID, { trackingEnabled: false })
    .flatMap((section) => section.items)
    .find((entry) => entry.sub?.length)
  expect(item, 'this role has no grouped nav item, so the flyout claim is untestable').toBeDefined()
  return item!
}

/** Every destination this role's rail is supposed to offer, groups included. */
function everyHref(): string[] {
  const sections = buildNavSections('company_admin', COMPANY_ID, { trackingEnabled: false })
  const hrefs: string[] = []
  for (const section of sections) {
    for (const item of section.items) {
      hrefs.push(item.href)
      for (const sub of item.sub ?? []) hrefs.push(sub.href)
    }
  }
  return [...new Set(hrefs)]
}

/**
 * Tab from the top of the document, collecting what focus lands on, until `stop`
 * says so or the budget runs out.
 *
 * Returns the elements rather than their names: the collapsed-rail assertions are
 * about `href`s and accessible names both, and re-querying by name would beg the
 * question the walk is asking.
 */
async function tabThrough(budget: number): Promise<HTMLElement[]> {
  const seen: HTMLElement[] = []
  for (let press = 0; press < budget; press += 1) {
    await userEvent.tab()
    const active = document.activeElement as HTMLElement | null
    if (!active || active === document.body) break
    if (seen.includes(active)) break
    seen.push(active)
  }
  return seen
}

describe('the shell is operable with a keyboard alone', () => {
  beforeEach(() => {
    setToken(tokenFor({ role: 'company_admin', companyId: COMPANY_ID, name: 'María Herrera' }))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ notifications: [] }), { status: 200 })),
    )
  })

  it('puts the skip link first, and it targets the routed page', async () => {
    renderShell()
    await userEvent.tab()

    const first = document.activeElement as HTMLElement
    expect(first.tagName).toBe('A')
    expect(first.textContent).toBe('Saltar al contenido')
    expect(first.getAttribute('href')).toBe('#main')

    // The target has to be the element that holds the page, not merely *an*
    // element with that id — a skip link pointing at the header would be a link
    // that skips nothing, and would still pass an `href === '#main'` assertion.
    const main = document.getElementById('main')!
    expect(main.tagName).toBe('MAIN')
    expect(within(main).getByText('página de planes')).toBeTruthy()
  })

  it('reaches every rail destination by Tab while expanded', async () => {
    renderShell()
    const rail = railElement()
    const reached = (await tabThrough(60))
      // Scoped to the rail, and that is not pedantry: `MobileNav` renders a second
      // `RoleBasedNav`-fed tab bar into the same document, hidden by `md:hidden` —
      // a class happy-dom has no layout engine to honour. An unscoped assertion
      // here would be satisfied by the phone bar while the rail was empty, which is
      // the shape of test that closes a question instead of answering it.
      .filter((element) => rail.contains(element))
      .map((element) => element.getAttribute('href'))
      .filter((href): href is string => Boolean(href))

    expect(reached.length, 'no rail row was reached at all').toBeGreaterThan(5)
    for (const href of everyHref()) {
      // A group's own href is behind a disclosure button while expanded, so the
      // set that must be *directly* reachable is the leaves; the group itself is
      // covered by the disclosure assertion below.
      if (href.startsWith(`/admin/companies/${COMPANY_ID}`) && !href.endsWith('/reports') && !href.endsWith('/analytics')) {
        continue
      }
      expect(reached, `no rail Tab stop links to ${href} with the rail expanded`).toContain(href)
    }
  })

  it('opens a rail group from the keyboard and reaches its children', async () => {
    renderShell()
    const rail = railElement()
    // The group row is a `<button aria-expanded>`, not a link that goes nowhere.
    const group = within(rail).getByRole('button', { name: /Administración de Empresa/ })
    expect(group.getAttribute('aria-expanded')).toBe('false')

    group.focus()
    await userEvent.keyboard('{Enter}')
    expect(group.getAttribute('aria-expanded')).toBe('true')

    for (const child of groupItem().sub!) {
      expect(
        rail.querySelector(`a[href="${child.href}"]`),
        `${child.href} is not in the rail after opening its group`,
      ).not.toBeNull()
    }
  })

  it('names every collapsed rail row, and reaches every destination through the flyout', async () => {
    renderShell()
    const rail = railElement()
    await userEvent.click(within(rail).getByRole('button', { name: 'Colapsar barra lateral' }))

    // 1. Named. With no text in a 52px rail the name can only come from
    //    `aria-label`, and an unnamed row is announced as "link" with nothing else.
    const rows = [...rail.querySelectorAll('a')]
    expect(rows.length, 'the collapsed rail rendered no rows').toBeGreaterThan(5)
    for (const link of rows) {
      expect(
        link.getAttribute('aria-label') || link.textContent?.trim(),
        `a collapsed rail row with href ${link.getAttribute('href')} has no accessible name`,
      ).toBeTruthy()
    }

    // 2. Reachable. The group's children are not rows while collapsed — they are
    //    in a flyout that only exists while the row has hover or focus. Tabbing to
    //    the group must produce them, which is the whole difference between
    //    "operable" and "visible".
    const group = groupItem()
    const groupRow = rail.querySelector<HTMLElement>(`a[href="${group.href}"]`)!
    expect(groupRow.getAttribute('aria-expanded')).toBe('false')
    // The children are genuinely absent first — otherwise "the flyout opened" is
    // indistinguishable from "they were always there".
    for (const child of group.sub!.filter((sub) => sub.href !== group.href)) {
      expect(rail.querySelector(`a[href="${child.href}"]`)).toBeNull()
    }

    // Reached by Tab, not by `.focus()`. The flyout opens on React's `onFocus`,
    // which is `focusin`, and both spellings deliver it — but only Tab proves the
    // row is *in the tab order at all*, which is the claim this test is making.
    let presses = 0
    while (document.activeElement !== groupRow && presses < 20) {
      await userEvent.tab()
      presses += 1
    }
    expect(document.activeElement, 'the collapsed group row is not reachable by Tab').toBe(groupRow)
    expect(groupRow.getAttribute('aria-expanded')).toBe('true')
    for (const child of group.sub!) {
      expect(
        rail.querySelector(`a[href="${child.href}"]`),
        `${child.href} is unreachable with the rail collapsed — the flyout did not open on focus`,
      ).not.toBeNull()
    }

    // 3. Escapable without moving focus, for a reader who did not want the panel.
    await userEvent.keyboard('{Escape}')
    expect(groupRow.getAttribute('aria-expanded')).toBe('false')
    for (const child of group.sub!.filter((sub) => sub.href !== group.href)) {
      expect(rail.querySelector(`a[href="${child.href}"]`)).toBeNull()
    }
  })

  it('passes axe with the rail expanded', async () => {
    const { container } = renderShell()
    await expectNoAxeViolations(container, 'shell (rail expanded)')
  })

  it('passes axe with the rail collapsed', async () => {
    const { container } = renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Colapsar barra lateral' }))
    await expectNoAxeViolations(container, 'shell (rail collapsed)')
  })

  it('passes axe with a rail group open', async () => {
    const { container } = renderShell()
    await userEvent.click(screen.getByRole('button', { name: /Administración de Empresa/ }))
    await expectNoAxeViolations(container, 'shell (group expanded)')
  })
})
