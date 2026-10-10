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

  it('drops a segment name rather than truncating it, and never drops the scale itself', () => {
    // Measured on the shared report at 390px: the opportunity and strength bands are a
    // quarter of the scale each, so "Área de oportunidad" and "Área de fortaleza" both cut
    // off — on the one surface that leaves the company. Re-measured after this change at
    // 1440/1024/768/600/390: three names shown and nothing clipped at 768 and above, no
    // names and nothing clipped below. happy-dom computes no layout, so what this test can
    // hold is the rule itself and the fact that nothing depends on the names being drawn.
    const { container } = render(
      <TranslationProvider initialLocale="es">
        <BandScaleBar bands={DEFAULT_RESULT_BANDS} />
      </TranslationProvider>,
    )
    // The rule is keyed to the BAR's own width, not the window: this component is drawn in
    // a report card and in a settings card, and a viewport breakpoint would be a guess
    // about the page instead of a fact about the bar.
    expect(container.querySelector('[data-testid="band-scale"]')!.className).toContain('@container')
    const names = [...container.querySelectorAll('[data-segment] > span:last-child')]
    expect(names).toHaveLength(3)
    for (const name of names) expect(name.className).toContain('@max-[38rem]:hidden')

    // Whatever the width, the whole scale stays in the accessible name — a reader who
    // cannot see the bar never depended on the drawn words.
    const img = container.querySelector('[role="img"]')!.getAttribute('aria-label')
    expect(img).toContain('Área de oportunidad 3,00–4,00')
    expect(img).toContain('Área de fortaleza 4,00–5,00')
  })
})
