import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSortHeader,
} from './table'

afterEach(cleanup)

describe('Table', () => {
  it('renders a real table with column headers', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Acme</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Acme' })).toBeTruthy()
  })

  it('scrolls the wrapper, not the page', () => {
    // A wide table must never make the whole page scroll sideways.
    const { container } = render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    expect(container.querySelector('[data-slot=table-container]')?.className).toContain(
      'overflow-x-auto',
    )
  })
})

describe('TableSortHeader', () => {
  it('reports no sort when it is not the active column', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableSortHeader label="Name" onSort={vi.fn()} />
          </TableRow>
        </TableHeader>
      </Table>,
    )
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('none')
  })

  it('reports the direction through aria-sort', () => {
    // Without aria-sort a screen-reader user cannot tell which column is sorted
    // or which way — the part a hand-rolled sort control always misses.
    const { rerender } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableSortHeader label="Name" direction="asc" onSort={vi.fn()} />
          </TableRow>
        </TableHeader>
      </Table>,
    )
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('ascending')

    rerender(
      <Table>
        <TableHeader>
          <TableRow>
            <TableSortHeader label="Name" direction="desc" onSort={vi.fn()} />
          </TableRow>
        </TableHeader>
      </Table>,
    )
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('descending')
  })

  it('sorts on click', async () => {
    const onSort = vi.fn()
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableSortHeader label="Name" onSort={onSort} />
          </TableRow>
        </TableHeader>
      </Table>,
    )
    await userEvent.click(screen.getByRole('button', { name: /Name/ }))
    expect(onSort).toHaveBeenCalledOnce()
  })

  it('sorts from the keyboard', async () => {
    const onSort = vi.fn()
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableSortHeader label="Name" onSort={onSort} />
          </TableRow>
        </TableHeader>
      </Table>,
    )
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(onSort).toHaveBeenCalledOnce()
  })
})

describe('TableEmpty', () => {
  it('renders inside the body and spans the columns', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Domain</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty colSpan={2}>No companies found</TableEmpty>
        </TableBody>
      </Table>,
    )
    const cell = screen.getByRole('cell', { name: 'No companies found' })
    expect(cell.getAttribute('colspan')).toBe('2')
    // Inside tbody, so the table's semantics still hold.
    expect(cell.closest('tbody')).not.toBeNull()
  })
})
