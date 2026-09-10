import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, within, screen } from '@testing-library/react'
import { TranslationProvider } from '../../../../i18n'
import TrendsNumbersTable from './TrendsNumbersTable'
import type { TrendDimension, TrendWave } from './model'
import en from '../../../../i18n/en.json'

const copy = en.surveys.next.trends

const waves: TrendWave[] = [
  { id: 'w1', code: 'Q1', name: 'Encuesta Q1', closedAt: '2026-02-12T00:00:00Z', completedCount: 24 },
  { id: 'w2', code: 'Q2', name: 'Encuesta Q2', closedAt: '2026-05-13T00:00:00Z', completedCount: 24 },
]

function renderTable(dimensions: TrendDimension[], withheld = [false, false], respondents: (number | null)[] = [24, 24]) {
  return render(
    <TranslationProvider>
      <TrendsNumbersTable
        waves={waves}
        withheld={withheld}
        respondents={respondents}
        dimensions={dimensions}
        target={3.7}
        floor={5}
        caption="caption"
      />
    </TranslationProvider>,
  )
}

describe('TrendsNumbersTable', () => {
  beforeEach(() => window.localStorage.setItem('preferredLocale', 'en'))
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('tints the reading each cell PRINTS by the Panel de Control’s bands, at every band edge', () => {
    renderTable([
      { key: 'a', name: 'A', values: [3.74, 4.04] },
      { key: 'b', name: 'B', values: [3.46, 2.64] },
      { key: 'c', name: 'C', values: [3.44, 4.06] },
    ])
    const tints = [...document.querySelectorAll('[data-slot="trends-cell"]')].map((cell) => ({
      text: cell.textContent,
      tint: cell.getAttribute('data-tint'),
    }))
    // Row by row: Q1's three cells, then Q2's. Steps 0..4 run far-below → far-above. Four
    // of these six land on a different step when the RAW reading is judged (3.74 raw is
    // above, 3.44 raw is on, 4.04 raw is far above, 2.64 raw is only below), so this pins
    // the printed-reading rule, not just the width of the bands. 3.46 → "3.5" is the
    // canvas's grey "en la meta", where the table used to paint pale red.
    expect(tints).toEqual([
      { text: '3.7', tint: '2' },
      { text: '3.5', tint: '2' },
      { text: '3.4', tint: '1' },
      { text: '4.0', tint: '3' },
      { text: '2.6', tint: '0' },
      { text: '4.1', tint: '4' },
    ])
  })

  it('gives the dimension columns equal widths beside a fixed survey column', () => {
    renderTable([
      { key: 'a', name: 'A', values: [3.5, 3.6] },
      { key: 'b', name: 'Seguridad psicológica', values: [3.5, 3.6] },
    ])
    const table = screen.getByRole('table')
    expect(table.className).toContain('table-fixed')
    const cols = [...table.querySelectorAll('colgroup col')]
    expect(cols).toHaveLength(3)
    expect(cols[0].className).toBe('w-45')
    // No dimension column carries a width of its own: `table-fixed` shares the rest equally.
    expect(cols.slice(1).every((col) => col.className === '')).toBe(true)
  })

  it('prints the first → last move as the difference of the printed readings: "2.8" → "3.3" is +0.5', () => {
    renderTable([{ key: 'w', name: 'W', values: [2.75, 3.33] }])
    const moveRow = document.querySelector('[data-slot="trends-move-row"]') as HTMLElement
    expect(moveRow.textContent).toContain('+0.5')
    expect(moveRow.textContent).not.toContain('+0.6')
  })

  it('never prints a reading or a count for a withheld wave, and marks a dimension not asked without a hatch or a zero', () => {
    renderTable(
      [
        { key: 'a', name: 'A', values: [null, 3.9] },
        { key: 'b', name: 'B', values: [null, null] },
      ],
      [true, false],
      [null, 6],
    )
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    // header, Q1 (withheld), Q2, and the move row
    expect(rows).toHaveLength(4)
    expect(within(rows[1]).getAllByRole('img')).toHaveLength(2)
    expect(rows[1].textContent).not.toContain('resp.')
    expect(rows[2].textContent).toContain('6 resp.')
    const notAsked = rows[2].querySelector('[data-slot="trends-not-asked"]') as HTMLElement
    expect(notAsked.textContent).toContain(copy.notAsked)
    expect(within(notAsked).queryByRole('img')).toBeNull()
    expect(notAsked.textContent).not.toMatch(/\d/)
    // Q1 → Q2 has a withheld end in both columns: no difference is printed.
    expect(rows[3].textContent).not.toMatch(/[+−-]\d/)
  })
})
