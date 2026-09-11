import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
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

  it('renders a link-less ancestor crumb as an ancestor, not as a second current page', () => {
    // CompanySettings artboard (10 Sep): "Administración de Empresa" is a sidebar group with no
    // page of its own, so it has no href — and it still reads muted, like any ancestor.
    renderTopBar({ title: 'Settings', breadcrumbs: [{ label: 'Company admin' }, { label: 'Settings' }] })
    const ancestor = screen.getByText('Company admin', { selector: '[data-slot="breadcrumb-ancestor"]' })
    expect(ancestor.getAttribute('aria-current')).toBeNull()
    const current = document.querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toBe('Settings')
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

    it('closes itself with a hairline rule, 16px under the content, as every artboard does', () => {
      const { container } = renderTopBar({ title: 'Companies' })
      const classes = topBar(container).className.split(/\s+/)
      expect(classes).toContain('border-b')
      expect(classes).toContain('border-line-light')
      // The artboards' `padding-bottom: 16px` (10 Sep). UI-0 had 14px.
      expect(classes).toContain('pb-4')
    })

    it('leaves 24px between the rule and whatever the page puts next', () => {
      const { container } = renderTopBar({ title: 'Companies' })
      // `mb-section` is --admin-size-section-gap, 24px: the gap every artboard of
      // 10 Sep leaves under the header's hairline. UI-0 had narrowed it to 16px.
      const classes = topBar(container).className.split(/\s+/)
      expect(classes).toContain('mb-section')
      expect(classes).not.toContain('mb-panel')
    })

    it('keeps 38px between the breadcrumb and the header, and 6px between its lines', () => {
      const { container } = renderTopBar({
        title: 'Companies',
        eyebrow: 'Administration',
        description: 'Every company on the platform',
        breadcrumbs: [{ label: 'Admin', href: '/admin' }, { label: 'Companies' }],
      })
      // The artboards: the breadcrumb's own 14px margin plus the page's 24px gap.
      expect(topBar(container).className.split(/\s+/)).toContain('gap-9.5')
      // Eyebrow, title and description: one column, 6px apart.
      const column = container.querySelector('[data-slot="page-eyebrow"]')!.parentElement!
      expect(column.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'gap-1.5']))
    })

    it('draws the rule itself rather than delegating to a Separator element', () => {
      // A separator is a sibling with margins of its own, so the 16px/24px split
      // above cannot be expressed with one. Its absence is the assertion.
      const { container } = renderTopBar({ title: 'Companies' })
      expect(container.querySelector('[data-slot="separator"]')).toBeNull()
    })

    it('sets the title at 24px, the size every artboard draws it at', () => {
      // --admin-text-3xl. UI-0 set the header a step down, at 20px; the approved
      // canvas (10 Sep) draws every page title at 24px, and the class says so rather
      // than leaning on index.css's bare-`h1` size.
      const { container } = renderTopBar({ title: 'Companies' })
      const classes = container.querySelector('h1')!.className.split(/\s+/)
      expect(classes).toContain('text-3xl')
      expect(classes).not.toContain('text-2xl')
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

    it('aligns the actions with the title, not with the middle of the block', () => {
      // `items-start`, not `items-center`. While the two share a line the text
      // column is three lines tall (eyebrow, title, description) against a
      // one-control-high action cluster, so centring floats the buttons into the
      // middle of the block.
      const { container } = renderTopBar({ title: 'Companies', actions: <button>New</button> })
      const row = container.querySelector('h1')!.closest('.justify-between')!
      expect(row.className.split(/\s+/)).toContain('items-start')
    })

    it('gives the text column a flex basis, so the actions can wrap off its line', () => {
      // THE ONE THING happy-dom CANNOT SEE, so it is asserted as the mechanism.
      //
      // Flexbox breaks a line when the items' flex BASE sizes stop fitting.
      // `flex-1` is `flex: 1 1 0%` — base size zero — so a row of `flex-wrap`
      // plus `flex-1` never wraps at any width; it shrinks the text column
      // toward nothing instead, which measured 1px wide by 5591px tall at a 320px
      // viewport with the right half of the header empty. `basis-header-text` is
      // 20rem, so the actions drop to their own line before the title is squeezed.
      //
      // The `flex-1` assertion is not redundant with the `basis-*` one: `flex-1`
      // is shorthand for all three of grow/shrink/basis, so leaving it beside
      // `basis-header-text` would re-zero the basis depending on order.
      const { container } = renderTopBar({ title: 'Companies', actions: <button>New</button> })
      const row = container.querySelector('h1')!.closest('.justify-between')!
      expect(row.className.split(/\s+/)).toContain('flex-wrap')
      const textColumn = container.querySelector('h1')!.closest('.justify-between > *')!
      const classes = textColumn.className.split(/\s+/)
      expect(classes).toContain('basis-header-text')
      expect(classes).toContain('grow')
      expect(classes).not.toContain('flex-1')
    })
  })
})

describe('PageTopBar — the meta line', () => {
  it('merges a caller metaClassName over the default spacing instead of adding a second class', () => {
    render(
      <TranslationProvider initialLocale="es">
        <MemoryRouter>
          <PageTopBar title="Plan" meta={<span>PA-1</span>} metaClassName="mt-0.5 gap-2.5" />
        </MemoryRouter>
      </TranslationProvider>,
    )
    const meta = document.querySelector('[data-slot="page-meta"]') as HTMLElement
    expect(meta.className).toContain('gap-2.5')
    expect(meta.className).toContain('mt-0.5')
    expect(meta.className).not.toMatch(/(^|\s)(gap-1\.5|mt-1\.5)(\s|$)/)
  })
})
