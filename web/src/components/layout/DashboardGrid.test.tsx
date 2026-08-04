import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ChartGrid, DashboardGrid, DetailGrid, GridItem, KPIGrid } from './DashboardGrid'
import { GRID_COLUMNS, GRID_GAP, GRID_SPAN } from './gridClasses'

afterEach(cleanup)

function grid(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>('[data-slot="dashboard-grid"]')
  if (!node) throw new Error('no grid rendered')
  return node
}

describe('DashboardGrid', () => {
  it('is one column on a phone at every column count', () => {
    // The whole point of the responsive tables: a four-across KPI row must not
    // put four 80px-wide cards side by side on a 320px screen.
    for (const classes of Object.values(GRID_COLUMNS)) {
      expect(classes.split(/\s+/)).toContain('grid-cols-1')
    }
  })

  it('applies the requested columns and gap', () => {
    const { container } = render(
      <DashboardGrid columns={4} gap="lg">
        <span>cell</span>
      </DashboardGrid>,
    )
    const classes = grid(container).className.split(/\s+/)
    expect(classes).toContain('grid')
    for (const token of GRID_COLUMNS[4].split(/\s+/)) expect(classes).toContain(token)
    expect(classes).toContain(GRID_GAP.lg)
  })

  it('defaults to three columns and the medium gap', () => {
    const { container } = render(<DashboardGrid><span>cell</span></DashboardGrid>)
    const classes = grid(container).className.split(/\s+/)
    for (const token of GRID_COLUMNS[3].split(/\s+/)) expect(classes).toContain(token)
    expect(classes).toContain(GRID_GAP.md)
  })

  it('lets a caller add classes without losing the grid ones', () => {
    const { container } = render(
      <DashboardGrid className="mt-4"><span>cell</span></DashboardGrid>,
    )
    const classes = grid(container).className.split(/\s+/)
    expect(classes).toContain('mt-4')
    expect(classes).toContain('grid')
  })

  it('forwards the rest of its div props', () => {
    render(
      <DashboardGrid aria-label="Overview" role="group">
        <span>cell</span>
      </DashboardGrid>,
    )
    expect(screen.getByRole('group', { name: 'Overview' })).toBeTruthy()
  })
})

describe('GridItem', () => {
  it('spans the requested columns and never overflows its track', () => {
    const { container } = render(<GridItem span={2}>cell</GridItem>)
    const classes = container.querySelector('[data-slot="grid-item"]')!.className.split(/\s+/)
    for (const token of GRID_SPAN[2].split(/\s+/)) expect(classes).toContain(token)
    // A grid track is `min-width: auto`, so without this one wide child overflows
    // the whole grid rather than scrolling inside its own cell.
    expect(classes).toContain('min-w-0')
  })

  it('spans one column by default', () => {
    const { container } = render(<GridItem>cell</GridItem>)
    expect(container.querySelector('[data-slot="grid-item"]')!.className).toContain('col-span-1')
  })
})

describe('the named layouts', () => {
  it.each([
    ['KPIGrid', KPIGrid, GRID_COLUMNS[4], GRID_GAP.md],
    ['ChartGrid', ChartGrid, GRID_COLUMNS[2], GRID_GAP.lg],
    ['DetailGrid', DetailGrid, GRID_COLUMNS[3], GRID_GAP.md],
  ] as const)('%s picks its columns and gap', (_name, Component, columns, gap) => {
    const { container } = render(<Component><span>cell</span></Component>)
    const classes = grid(container).className.split(/\s+/)
    for (const token of columns.split(/\s+/)) expect(classes).toContain(token)
    expect(classes).toContain(gap)
  })
})
