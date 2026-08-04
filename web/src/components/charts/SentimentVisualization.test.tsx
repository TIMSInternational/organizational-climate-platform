import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationProvider } from '../../i18n'
import { DIVERGING_COLORS } from './palette'
import SentimentVisualization from './SentimentVisualization'
import { SENTIMENT_STUB } from './sentimentStub'

afterEach(cleanup)

function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="en">{ui}</TranslationProvider>)
}

/** Reads a row of the breakdown table by its row header. */
function row(label: string): string[] {
  const header = screen.getByRole('rowheader', { name: new RegExp(label) })
  const cells = header.parentElement?.querySelectorAll('td') ?? []
  return [...cells].map((cell) => cell.textContent ?? '')
}

describe('SentimentVisualization', () => {
  it('states each count and share', () => {
    render(
      <SentimentVisualization data={{ positive: 50, neutral: 30, negative: 20 }} locale="en" />,
    )
    expect(row('Positive')).toEqual(['50', '50.0%'])
    expect(row('Neutral')).toEqual(['30', '30.0%'])
    expect(row('Negative')).toEqual(['20', '20.0%'])
  })

  it('states the total', () => {
    render(
      <SentimentVisualization data={{ positive: 50, neutral: 30, negative: 20 }} locale="en" />,
    )
    expect(screen.getByText('of 100 responses')).toBeTruthy()
  })

  /**
   * Sentiment is a diverging scale, not three statuses. Legacy used `bg-green-500`,
   * `bg-yellow-500` and `bg-red-500` — so neutral feedback rendered in the app's
   * *warning* colour, and a workforce that felt fine looked like a problem.
   */
  describe('colour', () => {
    it('uses the diverging palette, with a genuinely neutral midpoint', () => {
      const { container } = render(
        <SentimentVisualization data={{ positive: 50, neutral: 30, negative: 20 }} locale="en" />,
      )
      const swatches = [...container.querySelectorAll('span[style*="background-color"]')].map(
        (node) => (node as HTMLElement).style.backgroundColor,
      )
      expect(swatches).toContain(DIVERGING_COLORS[4]) // positive
      expect(swatches).toContain(DIVERGING_COLORS[2]) // neutral -- the grey midpoint
      expect(swatches).toContain(DIVERGING_COLORS[0]) // negative
    })

    it('does not paint neutral in the amber warning colour', () => {
      const { container } = render(
        <SentimentVisualization data={{ positive: 1, neutral: 1, negative: 1 }} locale="en" />,
      )
      expect(container.querySelector('.bg-accent-amber')).toBeNull()
    })
  })

  describe('net score', () => {
    it('is positive when positives dominate', () => {
      render(<SentimentVisualization data={{ positive: 80, neutral: 10, negative: 10 }} locale="en" />)
      expect(screen.getByText('70.0%')).toBeTruthy()
    })

    it('is negative when negatives dominate', () => {
      render(<SentimentVisualization data={{ positive: 10, neutral: 10, negative: 80 }} locale="en" />)
      expect(screen.getByText('-70.0%')).toBeTruthy()
    })

    /**
     * `divergingColor`'s dead band. 51 positive against 49 negative is a net of
     * +0.02, which must read neutral rather than being reported as a positive
     * result. The polarity is on the swatch, so that is where it is asserted.
     */
    it('marks a near-zero net with the neutral swatch', () => {
      const { container } = render(
        <SentimentVisualization data={{ positive: 51, neutral: 0, negative: 49 }} locale="en" />,
      )
      const swatches = [...container.querySelectorAll('span[style*="background-color"]')].map(
        (node) => (node as HTMLElement).style.backgroundColor,
      )
      // Positive and negative shares are both non-zero here, so the neutral colour
      // appearing at all can only come from the net-score swatch.
      expect(swatches).toContain(DIVERGING_COLORS[2])
    })

    /**
     * The palette rule is "text wears text tokens, never the series colour", and
     * this broke it: `divergingColor` returns *fill* colours, so a net score inside
     * the inner band rendered as pale blue on white -- measured at 1.6:1 on the
     * chart gallery, effectively unreadable.
     */
    it('renders the net figure in a text token, not a fill colour', () => {
      const { container } = render(
        <SentimentVisualization data={{ positive: 60, neutral: 20, negative: 20 }} locale="en" />,
      )
      const figure = [...container.querySelectorAll('span')].find(
        (node) => node.textContent === '40.0%',
      ) as HTMLElement | undefined
      expect(figure).toBeTruthy()
      expect(figure?.style.color).toBe('')
      expect(figure?.className).toContain('text-fg-primary')
    })
  })

  describe('degenerate input', () => {
    it('shows the empty state rather than dividing by zero', () => {
      render(<SentimentVisualization data={{ positive: 0, neutral: 0, negative: 0 }} locale="en" />)
      expect(screen.getByRole('status').textContent).toBe('No data to display')
      expect(screen.queryByRole('table')).toBeNull()
    })

    it('renders no NaN for any input', () => {
      const { container } = render(
        <SentimentVisualization
          data={{ positive: 10, neutral: Number.NaN, negative: -4 }}
          locale="en"
        />,
      )
      expect(container.textContent).not.toContain('NaN')
      expect(container.textContent).not.toContain('Infinity')
    })
  })

  it('shows loading separately from empty', () => {
    render(
      <SentimentVisualization
        data={{ positive: 0, neutral: 0, negative: 0 }}
        isLoading
        locale="en"
      />,
    )
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading chart data')
  })

  /**
   * The stacked bar is decorative — every share is stated in the table — so it is
   * hidden rather than read out as a row of meaningless boxes.
   */
  it('hides the bar from assistive tech', () => {
    const { container } = render(
      <SentimentVisualization data={{ positive: 1, neutral: 1, negative: 1 }} locale="en" />,
    )
    const bar = container.querySelector('[aria-hidden="true"]')
    expect(bar).toBeTruthy()
  })

  /**
   * Sentiment is blocked on #67, so every current caller is showing invented
   * numbers. A fabricated figure that looks like a measurement is worse than none.
   */
  describe('placeholder data', () => {
    it('says so on screen when told the figures are placeholders', () => {
      render(<SentimentVisualization data={SENTIMENT_STUB} isPlaceholder locale="en" />)
      expect(
        screen.getByText('Placeholder figures — sentiment analysis is not enabled yet'),
      ).toBeTruthy()
    })

    it('says nothing when the data is real', () => {
      render(<SentimentVisualization data={SENTIMENT_STUB} locale="en" />)
      expect(screen.queryByText(/Placeholder figures/)).toBeNull()
    })
  })
})
