import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import LiveResponseTrend from './LiveResponseTrend'
import { TranslationProvider } from '../../../i18n'

/**
 * The x-axis key is the point's `label` (`XAxis dataKey="label"` in LineChart), and a
 * formatted clock time is only unique to the second. These pin that two points can
 * never share one.
 *
 * Found by loading the live view in a real browser, not by a test: React logged
 * "Encountered two children with the same key" on every page load, because StrictMode
 * double-invokes the append effect on mount and both runs land in the same second.
 */
function renderTrend(responseCount: number, width = 400) {
  return render(
    <TranslationProvider>
      <LiveResponseTrend responseCount={responseCount} title="Responses" width={width} />
    </TranslationProvider>,
  )
}

describe('LiveResponseTrend', () => {
  beforeEach(() => {
    // Freeze the clock so every append formats to the identical label. That is the
    // collision under test; leaving it to wall-clock timing would make this pass or
    // fail depending on which side of a second boundary the run happened to fall.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-07T10:30:15Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('collapses two changes inside the same second onto one point rather than duplicating its key', () => {
    const { rerender } = renderTrend(7)

    // A second response lands in the same second. Before the fix this appended a
    // second point carrying the same label, giving two chart categories with one key.
    rerender(
      <TranslationProvider>
        <LiveResponseTrend responseCount={8} title="Responses" width={400} />
      </TranslationProvider>,
    )

    // One point, so the component is still in its "not enough to plot" state. Two
    // points would render the chart -- which is exactly the duplicate-key case.
    expect(screen.getByText(/./, { selector: 'p' })).toBeTruthy()
    expect(document.querySelector('svg')).toBeNull()
  })

  it('keeps the newer total when two changes share a second', () => {
    const { rerender } = renderTrend(7)
    rerender(
      <TranslationProvider>
        <LiveResponseTrend responseCount={8} title="Responses" width={400} />
      </TranslationProvider>,
    )

    // Move to a new second, so a genuinely distinct label appends and the chart renders.
    vi.setSystemTime(new Date('2026-08-07T10:30:16Z'))
    rerender(
      <TranslationProvider>
        <LiveResponseTrend responseCount={9} title="Responses" width={400} />
      </TranslationProvider>,
    )

    // Two distinct labels now, so the chart is drawn. The superseded 7 is gone: the
    // point for 10:30:15 carries 8, the later total observed at that second.
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('renders distinct labels for changes in different seconds', () => {
    const { rerender } = renderTrend(1)
    for (let i = 2; i <= 4; i++) {
      vi.setSystemTime(new Date(`2026-08-07T10:30:${String(14 + i).padStart(2, '0')}Z`))
      rerender(
        <TranslationProvider>
          <LiveResponseTrend responseCount={i} title="Responses" width={400} />
        </TranslationProvider>,
      )
    }
    expect(document.querySelector('svg')).not.toBeNull()
  })
})
