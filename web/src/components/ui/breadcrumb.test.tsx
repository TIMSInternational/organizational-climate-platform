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

describe('BreadcrumbList geometry', () => {
  // The element layer indents every `ol` (index.css, "Lists") for the classless pages. A
  // trail indented 20px in from the page title it sits over is the defect the per-role
  // canvas's screenshots showed; every artboard draws it flush.
  it('resets the element layer’s list indent and bullets, so the trail sits flush with the title', () => {
    render(<BreadcrumbList data-testid="trail" />)
    const trail = screen.getByTestId('trail')
    expect(trail.className).toContain('p-0')
    expect(trail.className).toContain('m-0')
    expect(trail.className).toContain('list-none')
  })
})

