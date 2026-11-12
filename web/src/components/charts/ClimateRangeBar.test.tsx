import { cleanup, render as rtlRender } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationProvider } from '../../i18n'
import ClimateRangeBar, { type ClimateRangeRow } from './ClimateRangeBar'
import { climateRangeOf, paintedSegments, rangeWindow, scalePercent, visibleGroups, type ClimateRangeGroup } from './climateRange'
import { DEFAULT_RESULT_BANDS, type ResultBands } from './resultBands'

afterEach(cleanup)

function render(ui: ReactElement, locale: 'en' | 'es' = 'en') {
  return rtlRender(<TranslationProvider initialLocale={locale}>{ui}</TranslationProvider>)
}

/** A company that moved both boundaries: opportunity from 3,50, strength from 4,30. */
const COMPANY: ResultBands = { ...DEFAULT_RESULT_BANDS, opportunityMin: 3.5, strengthMin: 4.3 }

const DEPARTMENTS: ClimateRangeGroup[] = [
  { name: 'Operaciones', mean: 4.24, protected: false },
  { name: 'Logística', mean: 3.42, protected: false },
  { name: 'Tecnología', mean: 4.51, protected: false },
]

/** The canvas's "Liderazgo y gestión" row: departments from 3,42 to 4,51, the company at 4,08. */
function leadership(overrides: Partial<ClimateRangeRow> = {}): ClimateRangeRow {
  return { key: 'leadership', label: 'Liderazgo y gestión', mean: 4.08, groups: DEPARTMENTS, ...overrides }
}

const track = (container: HTMLElement) => container.querySelector('[data-track]') as HTMLElement
/** What the track paints: each area's key, left edge and width, and whether it is muted. */
const painted = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[data-segment]')].map((segment) => [
    segment.getAttribute('data-segment'),
    segment.style.left,
    segment.style.width,
    segment.className.includes('opacity-40') ? 'muted' : 'lit',
  ])
const style = (container: HTMLElement, selector: string) => (container.querySelector(selector) as HTMLElement | null)?.style

/**
 * Every string the page says, to the eye or to AT: the text, and every accessible-name or
 * tooltip attribute (`aria-*`, `title`, `alt`). Class names and SVG geometry are not
 * speech; where a withheld value could hide in markup (a style offset), the test compares
 * the whole HTML instead.
 */
function everythingSaid(container: HTMLElement): string {
  const spoken = [...container.querySelectorAll('*')].flatMap((element) =>
    [...element.attributes].filter((attribute) => /^(aria-|title$|alt$)/.test(attribute.name) && attribute.name !== 'aria-hidden').map((attribute) => attribute.value),
  )
  return [container.textContent ?? '', ...spoken].join('\n')
}

describe('ClimateRangeBar', () => {
  it('paints the track in the company’s own areas, not a fixed 3,00 / 4,00', () => {
    const segments = (bands: ResultBands, row: ClimateRangeRow) => {
      const { container, unmount } = render(<ClimateRangeBar rows={[row]} bands={bands} floor={3} />)
      const drawn = painted(container)
      unmount()
      return drawn
    }
    // The whole scale, as a row with no range shows it: (3,50 − 1) / 4 = 62,5 %; (4,30 − 1) / 4 = 82,5 %.
    expect(segments(COMPANY, leadership({ groups: undefined }))).toEqual([
      ['critical', '0%', '62.5%', 'muted'],
      ['opportunity', '62.5%', '20%', 'muted'],
      ['strength', '82.5%', '17.5%', 'muted'],
    ])
    // The product default is a different picture, so the first one came from the props.
    expect(segments(DEFAULT_RESULT_BANDS, leadership({ groups: undefined }))).toEqual([
      ['critical', '0%', '50%', 'muted'],
      ['opportunity', '50%', '25%', 'muted'],
      ['strength', '75%', '25%', 'muted'],
    ])
    // And cut to the departments' 3,42–4,51, the company's boundaries still decide the colours.
    expect(segments(COMPANY, leadership())).toEqual([
      ['critical', '60.5%', '2%', 'lit'],
      ['opportunity', '62.5%', '20%', 'lit'],
      ['strength', '82.5%', '5.25%', 'lit'],
    ])
  })

  it('judges the chip by the company’s boundaries: 4,20 is opportunity where strength starts at 4,30', () => {
    const { container } = render(<ClimateRangeBar rows={[leadership({ mean: 4.2 })]} bands={COMPANY} floor={3} />)
    expect(container.querySelector('[data-slot="chip"]')?.getAttribute('data-band')).toBe('opportunity')
    cleanup()
    const fallback = render(<ClimateRangeBar rows={[leadership({ mean: 4.2 })]} bands={DEFAULT_RESULT_BANDS} floor={3} />)
    expect(fallback.container.querySelector('[data-slot="chip"]')?.getAttribute('data-band')).toBe('strength')
  })

  it('dims the track outside the lowest and highest disclosed group, and sets the dot on the served mean', () => {
    const { container } = render(<ClimateRangeBar rows={[leadership()]} bands={DEFAULT_RESULT_BANDS} floor={3} />)
    // The canvas's own figures for this row: lit from 60.5 % to 87.75 % (its .l 60.5 %, .r
    // 12.25 %), the dot at 77 %. The seam sits where opportunity meets strength, at 75 %.
    expect(painted(container)).toEqual([
      ['opportunity', '60.5%', '14.5%', 'lit'],
      ['strength', '75%', '12.75%', 'lit'],
    ])
    expect((container.querySelector('[data-segment="strength"]') as HTMLElement).className).toContain('border-l-2')
    expect((container.querySelector('[data-segment="opportunity"]') as HTMLElement).className).not.toContain('border-l-2')
    expect(style(container, '[data-mean]')?.left).toBe('77%')
    expect(container.querySelector('li[data-dimension]')?.getAttribute('data-range')).toBe('range')
    expect(container.textContent).toContain('Logística 3.42 · Tecnología 4.51')
    expect(track(container).getAttribute('role')).toBe('img')
    expect(track(container).getAttribute('aria-label')).toBe('From 3.42 to 4.51; mean 4.08')
  })

  it('a protected group moves nothing and is named nowhere, even with the lowest mean', () => {
    const withheld: ClimateRangeGroup[] = [
      ...DEPARTMENTS,
      // A payload that carried the number beside the flag, as a careless one might.
      { name: 'Finanzas', mean: 1.8, protected: true },
      // Nobody in Legal answered this dimension: absent, not 0.
      { name: 'Legal', mean: null, protected: false },
    ]
    const { container } = render(<ClimateRangeBar rows={[leadership({ groups: withheld })]} bands={DEFAULT_RESULT_BANDS} floor={3} />)
    const said = everythingSaid(container)
    for (const leak of ['Finanzas', '1.8', '1.80', 'Legal', '0.00']) expect(said).not.toContain(leak)
    // The range is still Logística to Tecnología: Finanzas's 1,80 did not stretch it.
    expect(painted(container)[0]).toEqual(['opportunity', '60.5%', '14.5%', 'lit'])
    expect(track(container).getAttribute('aria-label')).toBe('From 3.42 to 4.51; mean 4.08')

    // And the whole rendering is the one the withheld groups' absence would have drawn.
    const html = container.innerHTML
    cleanup()
    const without = render(<ClimateRangeBar rows={[leadership()]} bands={DEFAULT_RESULT_BANDS} floor={3} />)
    expect(html).toBe(without.container.innerHTML)
  })

  it('draws no range and names no group when fewer than two are visible', () => {
    const one: ClimateRangeGroup[] = [
      { name: 'Logística', mean: 3.42, protected: false },
      { name: 'Finanzas', mean: 2.1, protected: true },
    ]
    for (const groups of [one, [], undefined]) {
      const { container } = render(<ClimateRangeBar rows={[leadership({ groups })]} bands={DEFAULT_RESULT_BANDS} floor={3} />)
      // The whole scale, muted: nothing on the track claims a stretch of groups.
      expect(painted(container)).toEqual([
        ['critical', '0%', '50%', 'muted'],
        ['opportunity', '50%', '25%', 'muted'],
        ['strength', '75%', '25%', 'muted'],
      ])
      expect(container.querySelector('[data-mean]')).not.toBeNull()
      expect(container.querySelector('li[data-dimension]')?.getAttribute('data-range')).toBe('mean')
      expect(everythingSaid(container)).not.toContain('Logística')
      expect(everythingSaid(container)).not.toContain('Finanzas')
      expect(track(container).getAttribute('aria-label')).toBe('Mean 4.08')
      cleanup()
    }
  })

  it('a withheld mean shows the padlock and the server’s floor — no number, never 0, no dot, no range', () => {
    for (const row of [leadership({ mean: null }), leadership({ mean: 3.9, protected: true })]) {
      const { container } = render(<ClimateRangeBar rows={[row]} bands={DEFAULT_RESULT_BANDS} floor={3} showAxis={false} />)
      const mark = container.querySelector('[data-protected-mark]') as HTMLElement
      expect(mark.textContent).toBe('Fewer than 3')
      expect(mark.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
      // Nothing else on the row is a figure: not the withheld 3,90, not a 0, not the groups'.
      expect(everythingSaid(container).replace(/Fewer than 3|fewer than 3/g, '')).not.toMatch(/\d/)
      expect(container.querySelector('[data-mean]')).toBeNull()
      // A grey track: no area painted, so no position is implied.
      expect(container.querySelectorAll('[data-segment]')).toHaveLength(0)
      expect(container.querySelector('[data-slot="chip"]')).toBeNull()
      expect(track(container).getAttribute('aria-label')).toBe('Protected: fewer than 3 responses')
      cleanup()
    }
    // The floor is the payload's, not a constant: a surface that floors at 5 says 5.
    const raised = render(<ClimateRangeBar rows={[leadership({ mean: null })]} bands={DEFAULT_RESULT_BANDS} floor={5} />)
    expect(raised.container.querySelector('[data-protected-mark]')?.textContent).toBe('Fewer than 5')
  })

  it('writes every figure in the reader’s locale, at two decimals', () => {
    const { container } = render(
      <ClimateRangeBar rows={[leadership(), leadership({ key: 'belonging', label: 'Pertenencia', mean: 4, groups: undefined })]} bands={DEFAULT_RESULT_BANDS} floor={3} />,
      'es',
    )
    const [first, second] = [...container.querySelectorAll('li[data-dimension]')] as HTMLElement[]
    expect(first.textContent).toContain('Logística 3,42 · Tecnología 4,51')
    expect(first.textContent).toContain('4,08')
    expect(first.querySelector('[data-track]')?.getAttribute('aria-label')).toBe('De 3,42 a 4,51; media 4,08')
    expect(second.textContent).toContain('4,00')
    expect(second.querySelector('[data-track]')?.getAttribute('aria-label')).toBe('Media 4,00')
    expect(container.textContent).not.toContain('4.08')
  })

  it('reads on 0–100 for a company that does, on the same track', () => {
    const { container } = render(<ClimateRangeBar rows={[leadership()]} bands={{ ...DEFAULT_RESULT_BANDS, scale: 'percent' }} floor={3} />, 'es')
    expect(track(container).getAttribute('aria-label')).toBe('De 68,4 a 90,2; media 81,6')
    expect(style(container, '[data-mean]')?.left).toBe('77%')
    expect([...container.querySelectorAll('[data-axis-point]')].map((point) => point.textContent)).toEqual(['20', '40', '60', '80', '100'])
  })

  it('ticks a comparison on the track, names it in the caption and adds it to the label', () => {
    const { container } = render(
      <ClimateRangeBar rows={[leadership({ comparison: { label: 'Organización', mean: 3.74 } })]} bands={DEFAULT_RESULT_BANDS} floor={3} />,
    )
    expect(style(container, '[data-comparison]')?.left).toBe('68.5%')
    expect(container.textContent).toContain('Organización 3.74')
    expect(track(container).getAttribute('aria-label')).toBe('From 3.42 to 4.51; mean 4.08; Organización 3.74')
    cleanup()
    const withheld = render(
      <ClimateRangeBar rows={[leadership({ comparison: { label: 'Organización', mean: 3.74, protected: true } })]} bands={DEFAULT_RESULT_BANDS} floor={3} />,
    )
    expect(withheld.container.querySelector('[data-comparison]')).toBeNull()
    expect(everythingSaid(withheld.container)).not.toContain('Organización')
  })

  it('sets the axis figures where their values fall, under the tracks, hidden from AT', () => {
    const { container } = render(<ClimateRangeBar rows={[leadership()]} bands={DEFAULT_RESULT_BANDS} floor={3} />)
    const points = [...container.querySelectorAll<HTMLElement>('[data-axis-point]')]
    expect(points.map((point) => [point.textContent, point.style.left])).toEqual([
      ['1', '0%'],
      ['2', '25%'],
      ['3', '50%'],
      ['4', '75%'],
      ['5', '100%'],
    ])
    expect(container.querySelector('[data-climate-axis]')?.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('the climate range arithmetic', () => {
  it('keeps only disclosed groups with a finite mean', () => {
    expect(
      visibleGroups([
        { name: 'a', mean: 3, protected: false },
        { name: 'b', mean: 2, protected: true },
        { name: 'c', mean: null, protected: false },
        { name: 'd', mean: Number.NaN, protected: false },
      ]),
    ).toEqual([{ name: 'a', mean: 3 }])
  })

  it('needs two visible groups for a range, and takes the first on a tie', () => {
    expect(climateRangeOf([{ name: 'a', mean: 3, protected: false }])).toBeNull()
    expect(
      climateRangeOf([
        { name: 'a', mean: 3, protected: false },
        { name: 'b', mean: 3, protected: false },
        { name: 'c', mean: 4, protected: false },
      ]),
    ).toEqual({ low: { name: 'a', mean: 3 }, high: { name: 'c', mean: 4 } })
  })

  it('places a value on the 1–5 track and clamps what falls outside it', () => {
    expect(scalePercent(1)).toBe(0)
    expect(scalePercent(3.42)).toBe(60.5)
    expect(scalePercent(5)).toBe(100)
    expect(scalePercent(0.4)).toBe(0)
    expect(scalePercent(7)).toBe(100)
    expect(rangeWindow({ low: { name: 'a', mean: 2.71 }, high: { name: 'b', mean: 3.94 } })).toEqual({ from: 42.75, to: 73.5 })
  })

  it('cuts the areas to the window, seaming only real boundaries', () => {
    const range = { low: { name: 'a', mean: 2.71 }, high: { name: 'b', mean: 3.94 } }
    expect(paintedSegments(DEFAULT_RESULT_BANDS, range)).toEqual([
      { key: 'critical', from: 42.75, width: 7.25, seam: false },
      { key: 'opportunity', from: 50, width: 23.5, seam: true },
    ])
    // A window of zero width paints nothing; the dot alone marks the mean.
    expect(paintedSegments(DEFAULT_RESULT_BANDS, { low: { name: 'a', mean: 3.2 }, high: { name: 'b', mean: 3.2 } })).toEqual([])
  })
})
