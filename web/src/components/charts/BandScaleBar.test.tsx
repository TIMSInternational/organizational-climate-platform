import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TranslationProvider } from '../../i18n'
import BandScaleBar from './BandScaleBar'
import { DEFAULT_RESULT_BANDS } from './resultBands'

afterEach(cleanup)

describe('BandScaleBar', () => {
  it('draws the three areas end to end, each as wide as the stretch it covers', () => {
    const { container } = render(
      <TranslationProvider>
        <BandScaleBar bands={DEFAULT_RESULT_BANDS} />
      </TranslationProvider>,
    )
    const widths = [...container.querySelectorAll('[data-segment]')].map((segment) => [
      segment.getAttribute('data-segment'),
      (segment as HTMLElement).style.width,
    ])
    expect(widths).toEqual([
      ['critical', '50%'],
      ['opportunity', '25%'],
      ['strength', '25%'],
    ])
  })

  it('drops the second of two close edges to a second line, so a gap’s edges never print over each other', () => {
    const { container } = render(
      <TranslationProvider>
        <BandScaleBar
          bands={DEFAULT_RESULT_BANDS}
          segments={[
            { key: 'critical', from: 1, to: 3.49 },
            { key: 'gap', from: 3.49, to: 3.6 },
            { key: 'opportunity', from: 3.6, to: 4.19 },
            { key: 'strength', from: 4.2, to: 5 },
          ]}
          badTicks={[3.49, 3.6]}
        />
      </TranslationProvider>,
    )
    const tops = Object.fromEntries(
      [...container.querySelectorAll('[aria-hidden="true"] > span.absolute')].map((tick) => [
        tick.textContent,
        (tick as HTMLElement).style.top,
      ]),
    )
    expect(tops['3.49']).toBe('0px')
    expect(tops['3.60']).toBe('14px')
    expect(tops['4.19']).toBe('0px')
    expect(tops['4.20']).toBe('14px')
    expect(tops['1.00']).toBe('0px')
  })
})
