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
