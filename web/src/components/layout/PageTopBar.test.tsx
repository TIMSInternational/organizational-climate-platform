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
 *
 * The path is one **no nav row covers**, so the derived eyebrow is absent unless a
 * test passes one explicitly. It used to be `/`, which stopped being nav-less when
 * #132 added the Dashboard row: `isUnder` deliberately treats `/` as being under
 * `/dashboard` (the bare route redirects there), so every render here suddenly grew
 * a "WORKSPACE" eyebrow and the "omits unused containers" test failed on it. The
 * path was incidental to all eleven tests; being nav-less is what they assumed.
 */
function renderTopBar(props: PageTopBarProps) {
  const router = createMemoryRouter(
    [{ path: '/not-a-nav-destination', element: <PageTopBar {...props} /> }],
    { initialEntries: ['/not-a-nav-destination'] },
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

  /**
   * The page layout rule (UI-0): header, then the KPI row, then the work.
   *
   * happy-dom does no layout, so none of this can be measured here — the
   * geometry is looked at in `/dev/chart-gallery`, in both themes. What a test
   * *can* pin is that the classes carrying it are on the element, because the
   * failure mode is silent: a header that loses its rule still renders, and 27
   * pages then run into their content with nothing between.
   */
  describe('the .ptb geometry', () => {
    function topBar(container: HTMLElement): HTMLElement {
      const element = container.querySelector<HTMLElement>('[data-slot="page-top-bar"]')
      expect(element, 'the header root is findable').not.toBeNull()
      return element!
    }

    it('closes itself with a hairline rule, 14px under the content', () => {
      const { container } = renderTopBar({ title: 'Companies' })
      const classes = topBar(container).className.split(/\s+/)
      expect(classes).toContain('border-b')
      expect(classes).toContain('border-line-light')
      expect(classes).toContain('pb-3.5')
    })

    it('leaves 16px between the rule and whatever the page puts next', () => {
      const { container } = renderTopBar({ title: 'Companies' })
      // `mb-panel` is --admin-size-panel-padding, 16px. It was `mb-section`
      // (24px) with a `<Separator />` inside before UI-0.
      expect(topBar(container).className.split(/\s+/)).toContain('mb-panel')
    })

    it('draws the rule itself rather than delegating to a Separator element', () => {
      // A separator is a sibling with margins of its own, so the 14px/16px split
      // above cannot be expressed with one. Its absence is the assertion.
      const { container } = renderTopBar({ title: 'Companies' })
      expect(container.querySelector('[data-slot="separator"]')).toBeNull()
    })

    it('sets the title at the header size, not at the bare h1 size', () => {
      // index.css gives a bare `h1` --admin-text-3xl (24px). The redesign's page
      // header is a step down from that; without the class it inherits 24px.
      const { container } = renderTopBar({ title: 'Companies' })
      expect(container.querySelector('h1')!.className.split(/\s+/)).toContain('text-2xl')
    })

    it('caps the description and nothing else', () => {
      // Only prose is capped: tables and charts fill the width. The assertion is
      // that the cap sits on the `<p>` and not on the header box around it.
      const { container } = renderTopBar({
        title: 'Companies',
        description: 'Every company on the platform',
      })
      const description = container.querySelector('p:not([data-slot="page-eyebrow"])')!
      expect(description.className.split(/\s+/)).toContain('max-w-measure')
      expect(topBar(container).className).not.toContain('max-w-measure')
    })

    it('keeps the title at the top when the actions wrap', () => {
      // `items-start`, not `items-center`: with two rows of buttons beside it a
      // centred title floats to the middle of the block.
      const { container } = renderTopBar({ title: 'Companies', actions: <button>New</button> })
      const row = container.querySelector('h1')!.closest('.justify-between')!
      expect(row.className.split(/\s+/)).toContain('items-start')
    })
  })
})
