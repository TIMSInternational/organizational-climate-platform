import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import KpiTile from './KpiTile'

afterEach(cleanup)

/**
 * `KpiTile` renders no copy of its own — every string is passed in already
 * translated — so there is no `TranslationProvider` here, unlike `KPIDisplay`'s
 * test. If that ever becomes necessary it means the component started
 * translating, which is the thing its prop contract forbids.
 */
describe('KpiTile', () => {
  it('renders the reading and its label', () => {
    render(<KpiTile label="Climate index" value={72} />)
    expect(screen.getByText('Climate index')).toBeTruthy()
    expect(screen.getByText('72')).toBeTruthy()
  })

  it('sets the number in tabular mono, and leaves the label in the sans face', () => {
    // The typographic rule is the whole design thesis, so it is pinned rather
    // than left to the eye: a value that silently loses `tabular-nums` shifts
    // width as it updates and the row stops reading as an instrument.
    render(<KpiTile label="Participation" value={84} />)
    const value = screen.getByText('84')
    expect(value.className).toContain('font-mono')
    expect(value.className).toContain('tabular-nums')
    expect(screen.getByText('Participation').className).not.toContain('font-mono')
  })

  describe('the change indicator', () => {
    it('paints a rise green when up is good news', () => {
      render(<KpiTile label="Climate index" value={72} previousValue={68} />)
      const delta = screen.getByText('4')
      expect(delta.closest('span')?.parentElement?.className).toContain('text-accent-green')
    })

    it('paints a rise RED when up is bad news — rising attrition is not good', () => {
      // This is the legacy defect the component exists not to repeat: the old
      // code keyed the colour off the direction alone, so climbing attrition
      // rendered green. `higherIsBetter` is what decides the tone.
      render(
        <KpiTile label="Attrition" value={12} previousValue={8} higherIsBetter={false} />,
      )
      const delta = screen.getByText('4')
      expect(delta.closest('span')?.parentElement?.className).toContain('text-accent-red')
    })

    it('paints a fall GREEN when down is good news', () => {
      render(
        <KpiTile label="Attrition" value={8} previousValue={12} higherIsBetter={false} />,
      )
      const delta = screen.getByText('4')
      expect(delta.closest('span')?.parentElement?.className).toContain('text-accent-green')
    })

    it('never carries the direction by colour alone (WCAG 1.4.1)', () => {
      const { container } = render(
        <KpiTile label="Climate index" value={72} previousValue={68} />,
      )
      // A reader who cannot separate the two hues still gets the direction from
      // the caret and the magnitude beside it.
      expect(container.textContent).toContain('▲')
      expect(container.textContent).toContain('4')
    })

    it('marks the caret aria-hidden, since the magnitude already carries it', () => {
      const { container } = render(
        <KpiTile label="Climate index" value={72} previousValue={68} />,
      )
      const caret = [...container.querySelectorAll('[aria-hidden="true"]')].find((n) =>
        n.textContent?.includes('▲'),
      )
      expect(caret, 'the direction caret should be hidden from assistive tech').toBeDefined()
    })

    it('shows no indicator at all when there is nothing to compare against', () => {
      // "no change" and "no comparison available" are different statements and
      // must not look alike — so an omitted previousValue renders neither arrow.
      const { container } = render(<KpiTile label="Open action plans" value={7} />)
      expect(container.textContent).not.toContain('▲')
      expect(container.textContent).not.toContain('▼')
    })

    it('shows no indicator when the value is unchanged', () => {
      const { container } = render(
        <KpiTile label="Open action plans" value={7} previousValue={7} />,
      )
      expect(container.textContent).not.toContain('▲')
      expect(container.textContent).not.toContain('▼')
    })
  })

  it('formats the delta the same way as the value, since they share units', () => {
    render(
      <KpiTile
        label="Participation"
        value={84}
        previousValue={80}
        format={{ kind: 'percentage' }}
      />,
    )
    expect(screen.getByText('84%')).toBeTruthy()
    expect(screen.getByText('4%')).toBeTruthy()
  })

  it('renders a free-form sub-line for the tiles whose context is not a delta', () => {
    render(<KpiTile label="Participation" value={84} sub={<span>175 of 208</span>} />)
    expect(screen.getByText('175 of 208')).toBeTruthy()
  })
})
