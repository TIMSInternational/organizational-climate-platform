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

  it('tints the reading the cell prints, by the chips’ rule: 3.79 prints 3.8 and is above, 3.67 prints 3.7 and is on', () => {
    renderTable([
      { key: 'a', name: 'A', values: [3.79, 4.3] },
      { key: 'b', name: 'B', values: [3.67, 2.4] },
      { key: 'c', name: 'C', values: [3.6, 3.0] },
    ])
    const tints = [...document.querySelectorAll('[data-slot="trends-cell"]')].map((cell) => ({
      text: cell.textContent,
      tint: cell.getAttribute('data-tint'),
    }))
    // Row by row: Q1's three cells, then Q2's. Steps 0..4 run far-below → far-above.
    expect(tints).toEqual([
      { text: '3.8', tint: '3' },
      { text: '3.7', tint: '2' },
      { text: '3.6', tint: '1' },
      { text: '4.3', tint: '3' },
      { text: '2.4', tint: '0' },
      { text: '3.0', tint: '1' },
    ])
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
