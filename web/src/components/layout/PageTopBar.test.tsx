import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider } from '../../i18n'
import { PageTopBar, type PageTopBarProps } from './PageTopBar'

afterEach(cleanup)

/**
 * `PageTopBar` renders router `<Link>`s for its crumbs, so it needs a router in
 * context — and a `TranslationProvider`, because the default breadcrumb label
 * comes from the catalogue.
 */
function renderTopBar(props: PageTopBarProps) {
  const router = createMemoryRouter(
    [{ path: '/', element: <PageTopBar {...props} /> }],
    { initialEntries: ['/'] },
  )
  return render(
    <TranslationProvider>
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

describe('PageTopBar', () => {
  it('renders the title as the page heading', () => {
    renderTopBar({ title: 'Companies' })
    expect(screen.getByRole('heading', { level: 1, name: 'Companies' })).toBeTruthy()
  })

  it('renders no breadcrumb nav when there are no crumbs', () => {
    renderTopBar({ title: 'Companies' })
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('links every crumb but the last, which is marked as the current page', () => {
    renderTopBar({
      title: 'Users',
      breadcrumbs: [
        { label: 'Acme', href: '/admin/companies/c1' },
        { label: 'Users' },
      ],
    })

    const crumb = screen.getByRole('link', { name: 'Acme' })
    expect(crumb.getAttribute('href')).toBe('/admin/companies/c1')

    // BreadcrumbPage carries role="link" + aria-current, not an <a>, so the last
    // crumb is findable by role but has no href.
    const current = screen.getByText('Users', { selector: '[data-slot="breadcrumb-page"]' })
    expect(current.getAttribute('aria-current')).toBe('page')
  })

  it('renders the last crumb unlinked even when it carries an href', () => {
    // A caller mapping over a route table will hand every crumb an href. The
    // current page must not become a link to itself.
    renderTopBar({
      title: 'Users',
      breadcrumbs: [
        { label: 'Acme', href: '/admin/companies/c1' },
        { label: 'Users', href: '/admin/companies/c1/users' },
      ],
    })
    // Not `queryByRole('link')`: the repo's `BreadcrumbPage` renders a `<span>`
    // with `role="link" aria-disabled="true"` (the shadcn shape), so it *is*
    // findable by that role. The claim is that it is not navigable.
    const current = screen.getByText('Users', { selector: '[data-slot="breadcrumb-page"]' })
    expect(current.tagName).toBe('SPAN')
    expect(current.getAttribute('href')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Users' })?.getAttribute('aria-disabled')).toBe('true')
  })

  it('names the breadcrumb nav from the catalogue rather than defaulting to English', () => {
    renderTopBar({ title: 'Users', breadcrumbs: [{ label: 'Acme' }] })
    // en.json shell.breadcrumb. The point is that it is *not* a literal in the
    // component: es.json carries a different string for the same key.
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy()
  })

  it('accepts an explicit breadcrumb label', () => {
    renderTopBar({ title: 'Users', breadcrumbLabel: 'Ruta', breadcrumbs: [{ label: 'Acme' }] })
    expect(screen.getByRole('navigation', { name: 'Ruta' })).toBeTruthy()
  })

  it('puts the separators between the crumbs as siblings, not nested inside them', () => {
    // An <li> inside an <li> is invalid markup and the legacy Navbar produced it.
    // Two crumbs means three list items: crumb, separator, crumb.
    renderTopBar({
      title: 'Users',
      breadcrumbs: [{ label: 'Acme', href: '/x' }, { label: 'Users' }],
    })
    const list = screen.getByRole('list')
    const items = [...list.children]
    expect(items).toHaveLength(3)
    expect(items[1].getAttribute('data-slot')).toBe('breadcrumb-separator')
    expect(items.every((item) => item.tagName === 'LI')).toBe(true)
    expect(list.querySelector('li li')).toBeNull()
  })

  it('renders the description and the badge', () => {
    renderTopBar({
      title: 'Microclimates',
      description: 'Real-time team feedback',
      badge: { text: 'Live', variant: 'destructive' },
    })
    expect(screen.getByText('Real-time team feedback')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
  })

  it('inks the description and the crumb links above the AA threshold', () => {
    // Measured in Chrome, both light and dark. `text-fg-tertiary` (#818181) on the
    // panel is 3.90:1 at 13px and the global `a { color: --admin-accent-blue }`
    // (#2E9098) is 3.78:1 at 12px -- both under WCAG AA's 4.5:1, both only in
    // light mode, so dark-mode-only review would have passed them. happy-dom
    // computes no colours, so the class is what can be asserted here.
    renderTopBar({
      title: 'Users',
      description: 'Manage team members',
      breadcrumbs: [{ label: 'Acme', href: '/x' }, { label: 'Users' }],
    })
    expect(screen.getByText('Manage team members').className).toContain('text-fg-secondary')
    expect(screen.getByRole('link', { name: 'Acme' }).className).toContain('text-fg-secondary')
  })

  it('renders the actions slot', () => {
    renderTopBar({ title: 'Companies', actions: <button>New company</button> })
    expect(screen.getByRole('button', { name: 'New company' })).toBeTruthy()
  })

  it('omits the description, badge and actions containers when unused', () => {
    const { container } = renderTopBar({ title: 'Companies' })
    expect(container.querySelector('p')).toBeNull()
    expect(container.querySelector('[data-slot="badge"]')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })
})
