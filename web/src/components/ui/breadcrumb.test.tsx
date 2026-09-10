import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './breadcrumb'

afterEach(cleanup)

describe('Breadcrumb', () => {
  it('is a navigation landmark named by the caller', () => {
    render(
      <Breadcrumb aria-label="Ruta">
        <BreadcrumbList />
      </Breadcrumb>,
    )
    // The label is copy, so it is the caller's — an English default would be wrong
    // in Spanish.
    expect(screen.getByRole('navigation', { name: 'Ruta' })).toBeTruthy()
  })

  it('marks the last crumb as the current page', () => {
    render(
      <Breadcrumb aria-label="Trail">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/admin/companies">Companies</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Acme</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    expect(screen.getByText('Acme').getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Companies' })).toBeTruthy()
  })

  it('hides separators from assistive tech', () => {
    const { container } = render(
      <Breadcrumb aria-label="Trail">
        <BreadcrumbList>
          <BreadcrumbSeparator />
        </BreadcrumbList>
      </Breadcrumb>,
    )
    // A screen reader should not read "chevron" between every crumb.
    expect(
      container.querySelector('[data-slot=breadcrumb-separator]')?.getAttribute('aria-hidden'),
    ).toBe('true')
  })

  it('gives the ellipsis a translated accessible name', () => {
    render(
      <Breadcrumb aria-label="Trail">
        <BreadcrumbList>
          <BreadcrumbEllipsis label="Más páginas" />
        </BreadcrumbList>
      </Breadcrumb>,
    )
    expect(screen.getByText('Más páginas')).toBeTruthy()
  })
})

describe('the breadcrumb trail sits flush', () => {
  it('drops the list margin, indent and bullets index.css gives every ol and li, at 13px', () => {
    const { container } = render(
      <Breadcrumb aria-label="Ruta">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/surveys">Encuestas</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Resultados</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    // The artboards (10 Sep) draw the trail at the title's own x, one 13px line tall.
    const list = container.querySelector('ol')!
    expect(list.className.split(/\s+/)).toEqual(expect.arrayContaining(['m-0', 'p-0', 'list-none', 'text-base']))
    for (const item of container.querySelectorAll('li')) expect(item.className.split(/\s+/)).toContain('mb-0')
  })
})
