import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router'
import { Building2, Target, Users } from 'lucide-react'
import { TranslationProvider } from '../i18n'
import { buildNavSections, type NavSection } from './navSections'
import RoleBasedNav from './RoleBasedNav'

afterEach(cleanup)

const COMPANY = 'c1'

/**
 * The rail under a real router at `initialPath`.
 *
 * `path: '*'` so any of the app's paths resolves here — the component reads
 * `useLocation().pathname` and nothing else from the router, and the point of
 * every test below is which row that pathname lights.
 */
function renderNav(sections: NavSection[], initialPath: string, collapsed = false) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <>
            <RoleBasedNav sections={sections} collapsed={collapsed} />
            <Outlet />
          </>
        ),
      },
    ],
    { initialEntries: [initialPath] },
  )
  return render(
    <TranslationProvider initialLocale="en">
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

/** Every row currently wearing the accent fill. A count, never a presence check. */
function selectedRows(): Element[] {
  return Array.from(document.querySelectorAll('[data-nav-state="selected"]'))
}

/**
 * The two groups that exist. `climate-project#22` listed five (Tracking,
 * Organization, Analytics, System Administration, Survey Management) and asked
 * for nesting coverage of the three that had none; the tree those names belong to
 * did not survive the stack migration, and `buildNavSections` now emits exactly
 * one group per admin role. These are they — the modern form of that item, which
 * is why the block below is parameterised rather than written twice.
 */
const GROUPS = [
  {
    role: 'super_admin',
    group: 'System Administration',
    children: ['Companies', 'System Settings'],
    // A child that is NOT the group's own href — the one the collapsed rail
    // could not reach before the flyout.
    childLabel: 'System Settings',
    childPath: '/admin/system-settings',
    // The group's own href, which is also its first child's — hence the flyout.
    groupPath: '/admin/companies',
  },
  {
    role: 'company_admin',
    group: 'Company Administration',
    children: ['Company Settings', 'Users', 'Demographic fields'],
    childLabel: 'Users',
    childPath: `/admin/companies/${COMPANY}/users`,
    groupPath: `/admin/companies/${COMPANY}`,
  },
] as const

describe('RoleBasedNav nesting', () => {
  it.each(GROUPS)('renders $group as a collapsed disclosure, not a link', ({ role, group, children }) => {
    renderNav(buildNavSections(role, COMPANY), '/notifications')

    const toggle = screen.getByRole('button', { name: group })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // Closed means closed: not merely hidden, absent.
    for (const child of children) {
      expect(screen.queryByRole('link', { name: child })).toBeNull()
    }
  })

  it.each(GROUPS)('reveals exactly $group’s own children when expanded', async ({ role, group, children }) => {
    renderNav(buildNavSections(role, COMPANY), '/notifications')
    const before = screen.getAllByRole('link').length

    await userEvent.click(screen.getByRole('button', { name: group }))

    expect(screen.getByRole('button', { name: group }).getAttribute('aria-expanded')).toBe('true')
    for (const child of children) {
      expect(screen.getByRole('link', { name: child })).toBeTruthy()
    }
    // A count, so a second copy of the sub-tree (or a child leaking out of a
    // group that was not opened) fails rather than passing on presence.
    expect(screen.getAllByRole('link').length).toBe(before + children.length)
  })

  it.each(GROUPS)('closes $group again on a second click', async ({ role, group, children }) => {
    renderNav(buildNavSections(role, COMPANY), '/notifications')
    const toggle = screen.getByRole('button', { name: group })

    await userEvent.click(toggle)
    await userEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link', { name: children[0] })).toBeNull()
  })

  it.each(GROUPS)('opens $group on first render when the page is one of its children', ({ role, group, children, childPath }) => {
    renderNav(buildNavSections(role, COMPANY), childPath)

    expect(screen.getByRole('button', { name: group }).getAttribute('aria-expanded')).toBe('true')
    for (const child of children) {
      expect(screen.getByRole('link', { name: child })).toBeTruthy()
    }
  })

  it.each(GROUPS)('lights exactly one row for a child page of $group', ({ role, childPath }) => {
    // The defect this counts: `/admin/companies/c1` is a string prefix of
    // `/admin/companies/c1/users`, so a prefix test lit the parent AND the child.
    // Asserting the child is present would pass in both worlds; asserting there
    // is one selected row is what fails.
    renderNav(buildNavSections(role, COMPANY), childPath)

    const selected = selectedRows()
    expect(selected).toHaveLength(1)
    expect(selected[0].getAttribute('href')).toBe(childPath)
  })

  it.each(GROUPS)('lights no row at all under $group for a page the nav does not carry', ({ role }) => {
    renderNav(buildNavSections(role, COMPANY), '/dev/chart-gallery')
    expect(selectedRows()).toHaveLength(0)
  })
})

/**
 * `climate-project#22`, item 3: the expand state was keyed by the *translated*
 * label, so two groups whose copy coincided toggled together — and whether they
 * did depended on the reader's locale.
 *
 * `navigation.actionPlans` and `actionPlans.title` are both "Action Plans" in
 * `en.json` and both "Planes de Acción" in `es.json`, which is what makes this
 * fixture a real collision rather than a contrived one.
 */
describe('RoleBasedNav expand state', () => {
  const COLLIDING: NavSection[] = [
    {
      titleKey: 'navigation.sectionWorkspace',
      items: [
        {
          labelKey: 'navigation.actionPlans',
          href: '/action-plans',
          icon: Target,
          sub: [{ labelKey: 'navigation.companies', href: '/admin/companies', icon: Building2 }],
        },
        {
          labelKey: 'actionPlans.title',
          href: '/microclimates',
          icon: Target,
          sub: [{ labelKey: 'navigation.users', href: `/admin/companies/${COMPANY}/users`, icon: Users }],
        },
      ],
    },
  ]

  it('toggles one group without toggling another that renders the same label', async () => {
    renderNav(COLLIDING, '/notifications')
    const toggles = screen.getAllByRole('button', { name: 'Action Plans' })
    expect(toggles).toHaveLength(2)

    await userEvent.click(toggles[0])

    expect(toggles[0].getAttribute('aria-expanded')).toBe('true')
    expect(toggles[1].getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('link', { name: 'Companies' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull()
  })
})

/**
 * `climate-project#22`, item 5 — the last of the six, and the one deferred as
 * "new UI behavior, not a minor fix".
 *
 * Both groups' `href` is the same page as their FIRST child, so while the rail was
 * collapsed every other child was unreachable without expanding it: System
 * settings for a super_admin, Users and Demographic fields for a company_admin.
 */
describe('RoleBasedNav collapsed flyout', () => {
  it.each(GROUPS)('keeps $group’s flyout closed until it is asked for', ({ role, group, children }) => {
    renderNav(buildNavSections(role, COMPANY), '/notifications', true)

    const row = screen.getByRole('link', { name: group })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('group', { name: group })).toBeNull()
    expect(screen.queryByRole('link', { name: children[1] })).toBeNull()
  })

  it.each(GROUPS)('opens $group’s children on hover', async ({ role, group, children }) => {
    renderNav(buildNavSections(role, COMPANY), '/notifications', true)

    await userEvent.hover(screen.getByRole('link', { name: group }))

    const flyout = screen.getByRole('group', { name: group })
    const links = within(flyout).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([...children])
    expect(screen.getByRole('link', { name: group }).getAttribute('aria-expanded')).toBe('true')
  })

  it.each(GROUPS)('closes $group’s flyout when the pointer leaves the row', async ({ role, group }) => {
    renderNav(buildNavSections(role, COMPANY), '/notifications', true)
    const row = screen.getByRole('link', { name: group })

    await userEvent.hover(row)
    expect(screen.getByRole('group', { name: group })).toBeTruthy()
    await userEvent.unhover(row)

    expect(screen.queryByRole('group', { name: group })).toBeNull()
  })

  it.each(GROUPS)('opens $group’s flyout on keyboard focus, so it is not pointer-only', ({ role, group, children }) => {
    // #83's requirement for this rail in one assertion: "ensure the sidebar's
    // collapsed mode is operable, not just visible". A hover-only flyout would
    // leave the same destinations unreachable for a keyboard user that the
    // collapsed rail left unreachable for everyone.
    renderNav(buildNavSections(role, COMPANY), '/notifications', true)
    const row = screen.getByRole('link', { name: group })

    fireEvent.focus(row)

    const flyout = screen.getByRole('group', { name: group })
    // In the tab order after the row, so Tab walks from the row straight into it.
    expect(row.compareDocumentPosition(flyout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(flyout).getAllByRole('link')).toHaveLength(children.length)
  })

  it.each(GROUPS)('dismisses $group’s flyout on Escape', ({ role, group }) => {
    renderNav(buildNavSections(role, COMPANY), '/notifications', true)
    const row = screen.getByRole('link', { name: group })

    fireEvent.focus(row)
    expect(screen.getByRole('group', { name: group })).toBeTruthy()
    fireEvent.keyDown(row, { key: 'Escape' })

    expect(screen.queryByRole('group', { name: group })).toBeNull()
  })

  it.each(GROUPS)('closes $group’s flyout once one of its links is followed', async ({ role, group, childLabel, childPath }) => {
    // `mouseleave` cannot be relied on for this: the panel unmounts under a
    // pointer that never moved, and the pointer is over the *destination* by the
    // time anyone looks. The pathname is what changed, so the pathname is what
    // closes it.
    renderNav(buildNavSections(role, COMPANY), '/notifications', true)

    await userEvent.hover(screen.getByRole('link', { name: group }))
    const target = within(screen.getByRole('group', { name: group })).getByRole('link', {
      name: childLabel,
    })
    expect(target.getAttribute('href')).toBe(childPath)
    await userEvent.click(target)

    expect(screen.queryByRole('group', { name: group })).toBeNull()
  })

  it.each(GROUPS)('shows no flyout for $group while the rail is expanded', async ({ role, group }) => {
    // The children are drawn in the rail there, so a panel would be a second copy
    // of them — the duplicate-row defect, arrived at from the other direction.
    renderNav(buildNavSections(role, COMPANY), '/notifications')

    await userEvent.hover(screen.getByRole('button', { name: group }))

    expect(screen.queryByRole('group', { name: group })).toBeNull()
  })

  it.each(GROUPS)('lights the collapsed $group row when one of its hidden children owns the page', ({ role, childPath, groupPath }) => {
    // Collapsed, the children are not rows at all, so without this the rail
    // showed NO selected row while sitting on System settings / Users. And still
    // exactly one: the row borrows the selection, it does not add one.
    renderNav(buildNavSections(role, COMPANY), childPath, true)

    const selected = selectedRows()
    expect(selected).toHaveLength(1)
    expect(selected[0].getAttribute('href')).toBe(groupPath)
  })

  it.each(GROUPS)('reaches every one of $role’s destinations while collapsed', async ({ role, group }) => {
    // The property the whole flyout exists for, stated over the role's own nav
    // rather than over the two hrefs this file happens to name.
    const sections = buildNavSections(role, COMPANY)
    const everyHref = sections.flatMap((section) =>
      section.items.flatMap((item) => [item.href, ...(item.sub ?? []).map((sub) => sub.href)]),
    )
    renderNav(sections, '/notifications', true)

    await userEvent.hover(screen.getByRole('link', { name: group }))

    const reachable = new Set(
      Array.from(document.querySelectorAll('a[href]')).map((link) => link.getAttribute('href')),
    )
    expect(everyHref.filter((href) => !reachable.has(href))).toEqual([])
  })
})

/**
 * `climate-project#22`, item 2's last clause: "no hover affordance on any row".
 *
 * Asserted against the stylesheet because there is nothing else to assert it
 * against — happy-dom applies no author CSS, so a rendered `:hover` has no
 * observable effect here. What the DOM assertion above *can* prove is the half
 * that made the rule impossible before: the rows no longer carry `background` or
 * `color` in their inline style, which used to outrank any rule in `index.css`.
 */
describe('RoleBasedNav row states', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')

  it('gives both row kinds a hover and focus-visible rule', () => {
    for (const selector of ['.nav-row:hover', '.nav-sub-row:hover', '.nav-row:focus-visible', '.nav-sub-row:focus-visible']) {
      expect(css, `${selector} has no rule`).toContain(selector)
    }
  })

  it('keeps the selected fill on a hovered selected row', () => {
    expect(css).toContain(".nav-row[data-nav-state='selected']:hover")
    expect(css).toContain(".nav-sub-row[data-nav-state='selected']:hover")
  })

  it('leaves the row colours to the stylesheet, so the hover rule is not outranked', async () => {
    renderNav(buildNavSections('company_admin', COMPANY), `/admin/companies/${COMPANY}/users`)

    const rows = Array.from(document.querySelectorAll('.nav-row, .nav-sub-row'))
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const inline = row.getAttribute('style') ?? ''
      expect(inline, `${row.textContent} still styles its own fill`).not.toMatch(/(^|;)\s*background/)
      expect(inline, `${row.textContent} still styles its own text colour`).not.toMatch(/(^|;)\s*color/)
    }
  })
})
