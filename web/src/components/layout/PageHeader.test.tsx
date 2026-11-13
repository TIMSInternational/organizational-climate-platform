import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { TranslationProvider, type Locale } from '../../i18n'
import { Button } from '../ui'
import { PageHeader, type PageHeaderProps } from './PageHeader'

afterEach(cleanup)

function renderHeader(props: PageHeaderProps, locale: Locale = 'es') {
  const router = createMemoryRouter([{ path: '*', element: <PageHeader {...props} /> }], { initialEntries: ['/surveys/s1'] })
  return render(
    <TranslationProvider initialLocale={locale}>
      <RouterProvider router={router} />
    </TranslationProvider>,
  )
}

const header = () => document.querySelector<HTMLElement>('[data-slot="page-header"]')!
const classes = (element: Element | null) => (element?.className ?? '').split(/\s+/)

describe('PageHeader', () => {
  it('renders the title as the page’s one heading', () => {
    renderHeader({ title: 'Todas las encuestas' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Todas las encuestas' })).toBeTruthy()
    // 30px, the boards' page title; the serif face and weight come from index.css's `h1`.
    expect(classes(screen.getByRole('heading', { level: 1 }))).toContain('text-3xl')
  })

  it('sets the eyebrow over the title: 11px, uppercase, tracked, semibold, in the label ink', () => {
    renderHeader({ title: 'Clima Organizacional 2026', eyebrow: 'Meridiano' })
    const eyebrow = document.querySelector('[data-slot="page-header-eyebrow"]')!
    expect(eyebrow.textContent).toBe('Meridiano')
    expect(classes(eyebrow)).toEqual(expect.arrayContaining(['text-2xs', 'uppercase', 'tracking-eyebrow', 'font-semibold', 'text-fg-label']))
    // Over the title, not under it.
    const title = screen.getByRole('heading', { level: 1 })
    expect(eyebrow.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sets the sub in 15px secondary ink, capped at the measure', () => {
    renderHeader({ title: 'Todas las encuestas', description: '12 encuestas: 3 activas.' })
    const sub = document.querySelector('[data-slot="page-header-description"]')!
    expect(sub.textContent).toBe('12 encuestas: 3 activas.')
    expect(classes(sub)).toEqual(expect.arrayContaining(['text-base', 'text-fg-secondary', 'max-w-measure']))
  })

  it('draws nothing it was not given: no eyebrow, sub, meta, crumbs or actions box', () => {
    renderHeader({ title: 'Solo el título' })
    expect(document.querySelector('[data-slot="page-header-eyebrow"]')).toBeNull()
    expect(document.querySelector('[data-slot="page-header-description"]')).toBeNull()
    expect(document.querySelector('[data-slot="page-header-meta"]')).toBeNull()
    expect(document.querySelector('[data-slot="page-header-actions"]')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('draws the one primary action LAST, after the secondary ones, at the trailing edge', () => {
    renderHeader({
      title: 'Todas las encuestas',
      actions: (
        <>
          <Button variant="outline">Importar desde Excel</Button>
          <Button variant="outline">Exportar</Button>
        </>
      ),
      primaryAction: <Button variant="primary">Nueva encuesta</Button>,
    })
    const box = document.querySelector('[data-slot="page-header-actions"]')!
    expect(within(box as HTMLElement).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Importar desde Excel',
      'Exportar',
      'Nueva encuesta',
    ])
  })

  it('renders a primary action on its own, and secondary actions on their own', () => {
    renderHeader({ title: 'A', primaryAction: <Button variant="primary">Nueva encuesta</Button> })
    expect(screen.getByRole('button', { name: 'Nueva encuesta' })).toBeTruthy()
    cleanup()
    renderHeader({ title: 'B', actions: <Button variant="outline">Exportar</Button> })
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeTruthy()
  })

  it('links every crumb but the last, which is the current page, with the separators as siblings', () => {
    renderHeader({
      title: 'Resultados',
      breadcrumbs: [
        { label: 'Todas las encuestas', href: '/surveys' },
        { label: 'Clima Organizacional 2026', href: '/surveys/s1' },
        { label: 'Resultados', href: '/surveys/s1/results' },
      ],
    })
    const nav = screen.getByRole('navigation', { name: 'Ruta de navegación' })
    const links = within(nav).getAllByRole('link')
    // The current page is announced as the page (`aria-current`) and is not a real link.
    const anchors = links.filter((link) => link.tagName === 'A')
    expect(anchors.map((link) => link.getAttribute('href'))).toEqual(['/surveys', '/surveys/s1'])
    const current = nav.querySelector('[aria-current="page"]')!
    expect(current.textContent).toBe('Resultados')
    expect(classes(current)).toContain('font-semibold')
    // Separators are `<li>`s of the list, never nested inside an item.
    for (const separator of nav.querySelectorAll('[data-slot="breadcrumb-separator"]')) {
      expect(separator.parentElement?.tagName).toBe('OL')
    }
    expect(nav.querySelectorAll('[data-slot="breadcrumb-separator"]')).toHaveLength(2)
    // 13px secondary ink, the boards' `.crumb`.
    expect(classes(nav.querySelector('ol'))).toEqual(expect.arrayContaining(['text-sm', 'text-fg-secondary']))
  })

  it('names the breadcrumb from the catalogue, in the reader’s language', () => {
    renderHeader({ title: 'Results', breadcrumbs: [{ label: 'Surveys', href: '/surveys' }, { label: 'Results' }] }, 'en')
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeTruthy()
  })

  /**
   * The suite has no layout engine, so the geometry the boards draw can only be pinned as the
   * classes that produce it; the screenshots measure the pixels.
   */
  describe('geometry', () => {
    it('closes the block with the hairline, 18px of air above it, and 24px before the page', () => {
      renderHeader({ title: 'A', description: 'b' })
      expect(classes(header())).toContain('mb-section')
      const row = header().lastElementChild!
      expect(classes(row)).toEqual(expect.arrayContaining(['border-b', 'border-line-default', 'pb-4.5']))
    })

    it('wraps the actions off the title’s line by the text column’s basis, and seats them at its foot', () => {
      renderHeader({ title: 'A', actions: <Button variant="outline">x</Button> })
      const row = header().lastElementChild!
      expect(classes(row)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'items-end']))
      const text = document.querySelector('[data-slot="page-header-text"]')!
      expect(classes(text)).toEqual(expect.arrayContaining(['grow', 'basis-header-text', 'min-w-0']))
      expect(classes(text)).not.toContain('flex-1')
    })

    it('keeps 16px between the breadcrumb and the header block', () => {
      renderHeader({ title: 'A', breadcrumbs: [{ label: 'x', href: '/x' }, { label: 'A' }] })
      expect(classes(header())).toEqual(expect.arrayContaining(['flex', 'flex-col', 'gap-4']))
    })
  })
})
