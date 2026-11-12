import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
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

describe('Table, as the Apple design draws it', () => {
  function Rows({ zebra }: { zebra?: boolean }) {
    return (
      <Table zebra={zebra}>
        <TableHeader>
          <TableRow>
            <TableHead>Departamento</TableHead>
            <TableHead numeric>Respuestas</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {['Gestión', 'Finanzas', 'Operaciones'].map((name, index) => (
            <TableRow key={name}>
              <TableCell>{name}</TableCell>
              <TableCell numeric>{index + 10}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  it('sets the column head at 13px semibold in the tertiary ink', () => {
    render(<Rows />)
    const head = screen.getByRole('columnheader', { name: 'Departamento' }).className.split(/\s+/)
    expect(head).toEqual(expect.arrayContaining(['text-sm', 'font-semibold', 'text-fg-tertiary']))
    expect(head).not.toContain('uppercase')
  })

  it('sets the rows at the 15px body size, in tabular figures', () => {
    render(<Rows />)
    expect(screen.getByRole('table').className.split(/\s+/)).toEqual(expect.arrayContaining(['text-base', 'tabular-nums']))
  })

  it('right-aligns a numeric column, head and cells alike', () => {
    render(<Rows />)
    const head = screen.getByRole('columnheader', { name: 'Respuestas' })
    expect(head.className.split(/\s+/)).toContain('text-right')
    expect(head.getAttribute('data-numeric')).toBe('true')
    const cell = screen.getByRole('cell', { name: '10' })
    expect(cell.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-right', 'tabular-nums']))
    // A text column is left alone.
    expect(screen.getByRole('cell', { name: 'Gestión' }).className.split(/\s+/)).not.toContain('text-right')
  })

  it('stripes the body rows only when asked', () => {
    render(<Rows zebra />)
    const body = screen.getAllByRole('rowgroup')[1]!
    for (const row of within(body).getAllByRole('row')) {
      expect(row.className.split(/\s+/)).toContain('even:bg-surface-zebra')
    }
    cleanup()
    render(<Rows />)
    for (const row of screen.getAllByRole('row')) {
      expect(row.className.split(/\s+/)).not.toContain('even:bg-surface-zebra')
    }
  })

  it('keeps the row hover listed after the stripe, so a striped row still shows it', () => {
    render(<Rows zebra />)
    const classes = within(screen.getAllByRole('rowgroup')[1]!).getAllByRole('row')[0]!.className.split(/\s+/)
    expect(classes.indexOf('even:bg-surface-zebra')).toBeLessThan(classes.indexOf('hover:bg-state-hover'))
  })

  it('right-aligns a numeric sort header', async () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableSortHeader label="Respuestas" numeric onSort={() => {}} />
          </TableRow>
        </TableHeader>
      </Table>,
    )
    const head = screen.getByRole('columnheader')
    expect(head.className.split(/\s+/)).toContain('text-right')
    expect(within(head).getByRole('button').className.split(/\s+/)).toContain('justify-end')
  })
})
