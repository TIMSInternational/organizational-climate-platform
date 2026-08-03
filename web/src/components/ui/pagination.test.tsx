import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './pagination'
import { usePagination } from './usePagination'

afterEach(cleanup)

describe('usePagination', () => {
  function range(page: number, totalItems: number, pageSize = 10, siblings = 1) {
    return renderHook(() => usePagination({ page, pageSize, totalItems, siblings })).result.current
  }

  it('lists every page when they all fit', () => {
    expect(range(1, 30).items).toEqual([1, 2, 3])
  })

  it('always keeps the first and last page reachable', () => {
    const { items } = range(10, 200)
    expect(items[0]).toBe(1)
    expect(items.at(-1)).toBe(20)
  })

  it('elides with null on both sides of a middle page', () => {
    expect(range(10, 200).items).toEqual([1, null, 9, 10, 11, null, 20])
  })

  it('renders a single skipped page as that page, not an ellipsis', () => {
    // An ellipsis hiding exactly one number is worse than the number.
    const { items } = range(3, 200)
    expect(items.slice(0, 5)).toEqual([1, 2, 3, 4, null])
    expect(items).not.toContain(undefined)
  })

  it('reports what can be navigated to', () => {
    expect(range(1, 200).canPreviousPage).toBe(false)
    expect(range(1, 200).canNextPage).toBe(true)
    expect(range(20, 200).canPreviousPage).toBe(true)
    expect(range(20, 200).canNextPage).toBe(false)
  })

  it('never reports fewer than one page, even with no items', () => {
    const { totalPages, items } = range(1, 0)
    expect(totalPages).toBe(1)
    expect(items).toEqual([1])
  })

  it('rounds a partial last page up', () => {
    expect(range(1, 21).totalPages).toBe(3)
  })

  it('widens the window with more siblings', () => {
    expect(range(10, 200, 10, 2).items).toEqual([1, null, 8, 9, 10, 11, 12, null, 20])
  })
})

describe('Pagination', () => {
  it('marks the current page with aria-current', () => {
    render(
      <Pagination aria-label="Pages">
        <PaginationContent>
          <PaginationItem>
            <PaginationLink isActive>1</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink>2</PaginationLink>
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    )
    expect(screen.getByRole('button', { name: '1' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: '2' }).getAttribute('aria-current')).toBeNull()
  })

  it('labels prev/next from the caller, not hardcoded English', () => {
    render(
      <Pagination aria-label="Páginas">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious label="Anterior" />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext label="Siguiente" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    )
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeTruthy()
  })

  it('navigates on click', async () => {
    const onClick = vi.fn()
    render(
      <Pagination aria-label="Pages">
        <PaginationContent>
          <PaginationItem>
            <PaginationNext label="Next" onClick={onClick} />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('exposes a navigation landmark named by the caller', () => {
    render(
      <Pagination aria-label="Pages">
        <PaginationContent />
      </Pagination>,
    )
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeTruthy()
  })
})
