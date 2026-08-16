import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import DistributionStrip from './DistributionStrip'

afterEach(cleanup)

/**
 * `DistributionStrip` renders no copy of its own — every string arrives already
 * translated — so there is no `TranslationProvider` here; see `KpiTile.test.tsx`
 * for the contract.
 *
 * The assertions read the rendered inline styles and text, not internal state:
 * the colour-by-position rule and the count-inside-the-segment rule are what the
 * reader sees, and this repository has shipped tests that passed while the
 * rendered form was wrong.
 */
describe('DistributionStrip', () => {
  const ends = { minEnd: '1 · Strongly disagree', maxEnd: '5 · Strongly agree' }

  function likert(counts: [number, number, number, number, number]) {
    const words = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree']
    return counts.map((count, index) => ({
      key: String(index + 1),
      position: index + 1,
      count,
      label: `${words[index]} (${index + 1}): ${count} of ${counts.reduce((a, b) => a + b, 0)}`,
    }))
  }

  it('lands the five points of a 1-5 scale on the five diverging steps, fills and inks paired', () => {
    render(
      <DistributionStrip segments={likert([10, 10, 10, 10, 10])} min={1} max={5} {...ends} />,
    )

    const marks = screen.getAllByRole('img')
    const fills = marks.map((mark) => mark.style.backgroundColor)
    const inks = marks.map((mark) => mark.style.color)

    // Disagree red, neutral gray, agree blue — the climate map's own ramp, in
    // scale order. A strip whose colour said something else would put two
    // meanings on one hue on the results page.
    expect(fills).toEqual([
      'var(--admin-chart-div-neg-2)',
      'var(--admin-chart-div-neg-1)',
      'var(--admin-chart-div-mid)',
      'var(--admin-chart-div-pos-1)',
      'var(--admin-chart-div-pos-2)',
    ])
    // Each ink belongs to its own step — pairing them independently is the exact
    // bug divergingPair exists to prevent (#208).
    expect(inks).toEqual([
      'var(--admin-chart-div-neg-2-ink)',
      'var(--admin-chart-div-neg-1-ink)',
      'var(--admin-chart-div-mid-ink)',
      'var(--admin-chart-div-pos-1-ink)',
      'var(--admin-chart-div-pos-2-ink)',
    ])
  })

  it('colours by scale position, never by render index', () => {
    // Nobody disagreed at all: the answered buckets are 3, 4 and 5, sitting in
    // the UPPER half of the scale. An index-based mapping spreads any three
    // segments evenly across the whole ramp and would paint "Neutral" in
    // saturated red — a symmetric fixture (1/3/5) cannot tell the two apart,
    // which is exactly how the first version of this test let that mutant live.
    const segments = [
      { key: '3', position: 3, count: 5, label: '3: 5 of 20' },
      { key: '4', position: 4, count: 10, label: '4: 10 of 20' },
      { key: '5', position: 5, count: 5, label: '5: 5 of 20' },
    ]
    render(<DistributionStrip segments={segments} min={1} max={5} {...ends} />)

    const fills = screen.getAllByRole('img').map((mark) => mark.style.backgroundColor)
    expect(fills).toEqual([
      'var(--admin-chart-div-mid)',
      'var(--admin-chart-div-pos-1)',
      'var(--admin-chart-div-pos-2)',
    ])
  })

  it('carries the distribution in the segment widths', () => {
    render(
      <DistributionStrip segments={likert([1, 2, 3, 13, 5])} min={1} max={5} {...ends} />,
    )
    const grows = screen.getAllByRole('img').map((mark) => mark.style.flexGrow)
    expect(grows).toEqual(['1', '2', '3', '13', '5'])
  })

  it('prints the count inside a wide segment and withholds it from a thin one — which keeps its label', () => {
    render(
      <DistributionStrip segments={likert([1, 2, 3, 13, 5])} min={1} max={5} {...ends} />,
    )

    // 13 of 24 is over half the strip: the count is painted on the mark.
    expect(screen.getByText('13')).toBeTruthy()
    // 1 of 24 is ~4% — no room for a figure, so none is painted...
    const thin = screen.getByRole('img', { name: /Strongly disagree \(1\)/ })
    expect(thin.textContent).toBe('')
    // ...but the tooltip and the accessible name still carry it.
    expect(thin.getAttribute('title')).toContain('1 of 24')
  })

  it('prints both scale ends under the strip', () => {
    render(
      <DistributionStrip segments={likert([2, 5, 6, 8, 3])} min={1} max={5} {...ends} />,
    )
    expect(screen.getByText('1 · Strongly disagree')).toBeTruthy()
    expect(screen.getByText('5 · Strongly agree')).toBeTruthy()
  })

  it('renders nothing for an empty distribution rather than an unlabelled track', () => {
    const { container } = render(
      <DistributionStrip segments={[]} min={1} max={5} {...ends} />,
    )
    expect(container.textContent).toBe('')
  })
})
