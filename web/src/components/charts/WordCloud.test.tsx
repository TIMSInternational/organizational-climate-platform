import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationProvider } from '../../i18n'
import { DIVERGING_COLORS, SERIES_COLORS } from './palette'
import WordCloud, { type WordFrequency } from './WordCloud'
import { WORD_SIZE_CLASSES } from './wordScale'

afterEach(cleanup)

function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="en">{ui}</TranslationProvider>)
}

const data: WordFrequency[] = [
  { text: 'Innovation', value: 95, category: 'Culture' },
  { text: 'Collaboration', value: 60, category: 'Teamwork' },
  { text: 'Balance', value: 20, category: 'Culture' },
]

/** Words are addressed by their accessible name, which carries the count. */
function word(text: string, count: number): HTMLElement {
  return screen.getByLabelText(`${text}, ${count} occurrences`)
}

describe('WordCloud', () => {
  it('renders every word with its count in the accessible name', () => {
    render(<WordCloud data={data} />)
    expect(word('Innovation', 95)).toBeTruthy()
    expect(word('Collaboration', 60)).toBeTruthy()
    expect(word('Balance', 20)).toBeTruthy()
  })

  /**
   * The ranking is the information a word cloud carries, and reading order is what
   * conveys it — the legacy spiral and jittered-grid layouts put it in absolute
   * position, where nothing can read it and words overlapped anyway.
   */
  it('orders words by descending frequency', () => {
    render(<WordCloud data={[data[2], data[0], data[1]]} />)
    const rendered = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(rendered).toEqual(['Innovation', 'Collaboration', 'Balance'])
  })

  it('renders as a real list, so a screen reader announces the count of words', () => {
    render(<WordCloud data={data} />)
    expect(screen.getByRole('list')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  /**
   * The legacy widget sorted with a bare `data.sort()`, which reorders the caller's
   * own array as a side effect of rendering.
   */
  it('does not mutate the array it is given', () => {
    const input: WordFrequency[] = [
      { text: 'low', value: 1 },
      { text: 'high', value: 9 },
    ]
    const order = input.map((w) => w.text)
    render(<WordCloud data={input} />)
    expect(input.map((w) => w.text)).toEqual(order)
  })

  describe('sizing', () => {
    it('sizes the most frequent word larger than the least', () => {
      render(<WordCloud data={data} />)
      const biggest = word('Innovation', 95).className
      const smallest = word('Balance', 20).className
      expect(WORD_SIZE_CLASSES.findIndex((c) => biggest.includes(c))).toBeGreaterThan(
        WORD_SIZE_CLASSES.findIndex((c) => smallest.includes(c)),
      )
    })

    /** Type-scale utilities, never a computed pixel size -- see `wordScale.ts`. */
    it('sizes with a token class rather than an inline font size', () => {
      render(<WordCloud data={data} />)
      const node = word('Innovation', 95)
      expect(WORD_SIZE_CLASSES.some((c) => node.className.includes(c))).toBe(true)
      expect(node.style.fontSize).toBe('')
    })

    /**
     * The size range comes from the full ranked set, not the visible subset, so
     * filtering does not resize the survivors -- a word changing size because
     * something else left the screen reads as the data having changed.
     */
    it('keeps a word the same size after filtering', async () => {
      render(<WordCloud data={data} />)
      const before = word('Innovation', 95).className
      await userEvent.click(screen.getByRole('button', { name: 'Culture' }))
      expect(word('Innovation', 95).className).toBe(before)
    })
  })

  describe('values that are not counts', () => {
    it('drops zero and negative frequencies', () => {
      render(
        <WordCloud
          data={[
            { text: 'real', value: 5 },
            { text: 'zero', value: 0 },
            { text: 'negative', value: -3 },
          ]}
        />,
      )
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
      expect(screen.queryByText('zero')).toBeNull()
      expect(screen.queryByText('negative')).toBeNull()
    })

    it('shows the empty state when nothing is left', () => {
      render(<WordCloud data={[{ text: 'zero', value: 0 }]} />)
      expect(screen.getByRole('status').textContent).toBe('No data to display')
    })

    it('shows the empty state for no data at all', () => {
      render(<WordCloud data={[]} />)
      expect(screen.getByRole('status').textContent).toBe('No data to display')
    })
  })

  it('caps the number of words at maxWords, keeping the most frequent', () => {
    render(<WordCloud data={data} maxWords={2} />)
    const rendered = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(rendered).toEqual(['Innovation', 'Collaboration'])
  })

  /** Loading and empty are separate states; a spinner where the answer is "nothing"
      reads as a hung page. */
  it('shows loading separately from empty', () => {
    render(<WordCloud data={[]} isLoading />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading chart data')
  })

  describe('colour', () => {
    /**
     * Size already encodes frequency. Legacy coloured by `hsl(index * 137.5, ...)`,
     * a hue per array position, which encodes nothing while looking like it does.
     */
    it('encodes nothing in colour by default', () => {
      render(<WordCloud data={data} />)
      expect(word('Innovation', 95).style.color).toBe('')
    })

    it('uses the diverging scale for sentiment', () => {
      render(
        <WordCloud
          colorBy="sentiment"
          data={[
            { text: 'loved', value: 10, sentiment: 0.9 },
            { text: 'hated', value: 8, sentiment: -0.9 },
          ]}
        />,
      )
      expect(word('loved', 10).style.color).toBe(DIVERGING_COLORS[4])
      expect(word('hated', 8).style.color).toBe(DIVERGING_COLORS[0])
    })

    /** `divergingColor`'s dead band: a near-neutral word must not read as positive. */
    it('renders a barely-positive word as neutral', () => {
      render(
        <WordCloud colorBy="sentiment" data={[{ text: 'meh', value: 4, sentiment: 0.02 }]} />,
      )
      expect(word('meh', 4).style.color).toBe(DIVERGING_COLORS[2])
    })

    it('uses the categorical palette for categories', () => {
      render(<WordCloud colorBy="category" data={data} />)
      // Culture appears first, so it takes series 1; Teamwork series 2.
      expect(word('Innovation', 95).style.color).toBe(SERIES_COLORS[0])
      expect(word('Collaboration', 60).style.color).toBe(SERIES_COLORS[1])
      expect(word('Balance', 20).style.color).toBe(SERIES_COLORS[0])
    })

    /**
     * Colour follows the category, not its rank, so narrowing the view must not
     * repaint what is left.
     */
    it('does not repaint a category when the view is filtered', async () => {
      render(<WordCloud colorBy="category" data={data} />)
      await userEvent.click(screen.getByRole('button', { name: 'Teamwork' }))
      expect(word('Collaboration', 60).style.color).toBe(SERIES_COLORS[1])
    })
  })

  describe('category filter', () => {
    it('offers no filter when no word has a category', () => {
      render(<WordCloud data={[{ text: 'solo', value: 1 }]} />)
      expect(screen.queryByRole('button', { name: 'All' })).toBeNull()
    })

    it('narrows to one category and back', async () => {
      render(<WordCloud data={data} />)
      await userEvent.click(screen.getByRole('button', { name: 'Teamwork' }))
      expect(screen.getAllByRole('listitem')).toHaveLength(1)

      await userEvent.click(screen.getByRole('button', { name: 'All' }))
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
    })

    it('marks the active filter with aria-pressed', async () => {
      render(<WordCloud data={data} />)
      expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')

      await userEvent.click(screen.getByRole('button', { name: 'Culture' }))
      expect(screen.getByRole('button', { name: 'Culture' }).getAttribute('aria-pressed')).toBe(
        'true',
      )
      expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false')
    })

    /**
     * Regression: a folded category used to show the shared "Other" swatch, which
     * reads as "this is my colour" -- so on the gallery, Leadership and Enablement
     * both displayed the same purple dot and looked like one category. No swatch is
     * the honest signal, and the note names them.
     */
    it('gives no swatch to a category that folded, and names it instead', () => {
      const many: WordFrequency[] = Array.from({ length: 8 }, (_, index) => ({
        text: `w${index}`,
        value: 10 - index,
        category: `C${index}`,
      }))
      const { container } = render(<WordCloud colorBy="category" data={many} />)

      // Eight categories against a six-wide palette: C0-C4 keep a colour, C5-C7 fold.
      const named = screen.getByRole('button', { name: 'C0' })
      expect(named.querySelector('[aria-hidden="true"]')).toBeTruthy()

      const folded = screen.getByRole('button', { name: 'C7' })
      expect(folded.querySelector('[aria-hidden="true"]')).toBeNull()

      expect(container.textContent).toContain('C5, C6, C7 share one colour')
    })

    it('shows the empty state when a filter matches nothing left', async () => {
      render(<WordCloud data={data} maxWords={1} />)
      // Only "Innovation" (Culture) survives the cap, but Teamwork is still offered
      // -- selecting it must read as empty rather than rendering an empty list.
      expect(screen.queryByRole('button', { name: 'Teamwork' })).toBeNull()
    })
  })

  describe('selection', () => {
    it('renders plain text when there is nothing to select', () => {
      render(<WordCloud data={data} />)
      expect(screen.queryByRole('button', { name: /Innovation/ })).toBeNull()
    })

    it('makes each word a button when a handler is given, so a keyboard can reach it', async () => {
      const onWordSelect = vi.fn()
      render(<WordCloud data={data} onWordSelect={onWordSelect} />)

      await userEvent.click(screen.getByRole('button', { name: 'Innovation, 95 occurrences' }))
      expect(onWordSelect).toHaveBeenCalledWith(data[0])
    })
  })

  /** The table view is how identity survives without colour or size. */
  it('offers the counts as a table', async () => {
    render(<WordCloud data={data} />)
    await userEvent.click(screen.getByText('Show as table'))
    const table = screen.getByRole('table')
    expect(table.textContent).toContain('Frequency')
    expect(table.textContent).toContain('Innovation')
    expect(table.textContent).toContain('95')
  })
})
