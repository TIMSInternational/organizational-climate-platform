import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationProvider } from '../../i18n'
import ClimateMap, { type ClimateMapDimension, type ClimateMapRow } from './ClimateMap'

afterEach(cleanup)

function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="en">{ui}</TranslationProvider>)
}

const DIMENSIONS: ClimateMapDimension[] = [
  { key: 'safety', label: 'Safety', fullLabel: 'Psychological safety' },
  { key: 'workload', label: 'Workload' },
]

/** One row per band edge, so the whole scale is exercised by construction. */
function rowsAt(scores: number[], responses = 20): ClimateMapRow[] {
  return [{ id: 'ops', label: 'Operations', responses, scores }]
}

function cellFill(score: number, target = 70): string {
  const { container } = render(
    <ClimateMap dimensions={[DIMENSIONS[0]]} rows={rowsAt([score])} target={target} />,
  )
  const cell = [...container.querySelectorAll('td div')].at(0) as HTMLElement
  return cell.style.backgroundColor
}

describe('ClimateMap', () => {
  describe('the scale is diverging around the target', () => {
    // A sequential ramp would put the worst cell at the PALE end, where it reads
    // as empty space. These pin the polarity: the band edges must land exactly
    // where the design puts them, which is what the /(2*extremeAt) mapping does.
    it('renders a score on target as the neutral midpoint, not as weakly good', () => {
      expect(cellFill(70)).toContain('--admin-chart-div-mid')
    })

    it('keeps the whole dead band neutral', () => {
      expect(cellFill(72)).toContain('--admin-chart-div-mid')
      expect(cellFill(68)).toContain('--admin-chart-div-mid')
    })

    it('leaves the dead band as soon as the gap exceeds it', () => {
      expect(cellFill(73)).toContain('--admin-chart-div-pos-1')
      expect(cellFill(67)).toContain('--admin-chart-div-neg-1')
    })

    it('saturates at the extreme, and only at the extreme', () => {
      expect(cellFill(79)).toContain('--admin-chart-div-pos-1')
      expect(cellFill(80)).toContain('--admin-chart-div-pos-2')
      expect(cellFill(61)).toContain('--admin-chart-div-neg-1')
      expect(cellFill(60)).toContain('--admin-chart-div-neg-2')
    })

    it('moves the bands with the target rather than with the absolute score', () => {
      // The same score is good against one target and bad against another; a map
      // that keyed off the raw number would render both identically.
      expect(cellFill(60, 60)).toContain('--admin-chart-div-mid')
      expect(cellFill(60, 90)).toContain('--admin-chart-div-neg-2')
    })
  })

  it('says above/below target in words, never by colour alone (WCAG 1.4.1)', () => {
    const { container } = render(
      <ClimateMap dimensions={[DIMENSIONS[0]]} rows={rowsAt([58])} target={70} />,
    )
    expect(container.textContent).toContain('below the target of 70')
  })

  it('names the cell so a screen reader gets more than a bare number', () => {
    const { container } = render(
      <ClimateMap dimensions={[DIMENSIONS[0]]} rows={rowsAt([74])} target={70} />,
    )
    // The abbreviation is expanded — "Safety" is announced as its full name.
    expect(container.textContent).toContain('Operations, Psychological safety')
  })

  describe('a group under the anonymity floor', () => {
    const suppressed = [{ id: 'fin', label: 'Finance', responses: 4, scores: [79, 81] }]

    it('keeps its row rather than disappearing from the map', () => {
      // Dropping the row would misreport the shape of the organisation: the
      // reader would not know the group exists at all.
      render(<ClimateMap dimensions={DIMENSIONS} rows={suppressed} target={70} />)
      expect(screen.getByText('Finance')).toBeTruthy()
    })

    it('publishes none of its scores', () => {
      const { container } = render(
        <ClimateMap dimensions={DIMENSIONS} rows={suppressed} target={70} />,
      )
      expect(container.textContent).not.toContain('79')
      expect(container.textContent).not.toContain('81')
    })

    it('renders every one of its cells as protected, not just the first', () => {
      const { container } = render(
        <ClimateMap dimensions={DIMENSIONS} rows={suppressed} target={70} />,
      )
      expect(container.querySelectorAll('[role="img"]')).toHaveLength(DIMENSIONS.length)
    })

    it('does not leak the response count', () => {
      const { container } = render(
        <ClimateMap dimensions={DIMENSIONS} rows={suppressed} target={70} />,
      )
      expect(container.textContent ?? '').not.toContain('4 response')
    })
  })

  it('rings the cells worth acting on, and only those', () => {
    const { container } = render(
      <ClimateMap
        dimensions={DIMENSIONS}
        rows={[{ id: 'sup', label: 'Support', responses: 20, scores: [58, 68] }]}
        target={70}
      />,
    )
    const cells = [...container.querySelectorAll('td div')] as HTMLElement[]
    // 58 is a full extreme below target; 68 is inside the dead band.
    expect(cells[0].style.outline).toContain('--admin-chart-div-neg-2')
    expect(cells[1].style.outline).toBe('')
  })

  /**
   * The ring must be a ring, on any surface.
   *
   * It used to be a two-step box-shadow whose inner step was painted
   * `--admin-bg-panel`. The company dashboard stands this map on
   * `--admin-bg-icon-box`, so that spacer rendered as a white halo in light and a
   * near-black one in dark — the cell read as a sticker cut out of the tile rather
   * than as a marked cell, on the one cell the ring exists to draw the eye to.
   * An offset outline leaves its gap unpainted, so whatever is behind shows through.
   *
   * happy-dom does no layout and cannot see the halo; what it CAN see is that no
   * surface token is being painted into the gap, which is the whole of the defect.
   */
  it('draws the ring without painting a surface colour behind it', () => {
    const { container } = render(
      <ClimateMap
        dimensions={DIMENSIONS}
        rows={[{ id: 'sup', label: 'Support', responses: 20, scores: [58, 68] }]}
        target={70}
      />,
    )
    const ringed = container.querySelector('td div') as HTMLElement
    expect(ringed.style.outlineOffset).not.toBe('')
    expect(ringed.style.boxShadow).toBe('')
    expect(ringed.getAttribute('style') ?? '').not.toContain('--admin-bg-')
  })

  it('is a real table, so the axes are announced as headers', () => {
    const { container } = render(
      <ClimateMap dimensions={DIMENSIONS} rows={rowsAt([74, 61])} target={70} />,
    )
    expect(container.querySelector('th[scope="col"]')?.textContent).toBe('Safety')
    expect(container.querySelector('th[scope="row"]')?.textContent).toBe('Operations')
  })

  it('states the floor in the legend', () => {
    const { container } = render(
      <ClimateMap dimensions={DIMENSIONS} rows={rowsAt([74, 61])} target={70} threshold={8} />,
    )
    expect(container.textContent).toContain('under 8 responses')
  })
})
