import { act, cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationProvider } from '../../i18n'
import RealTimeChartContainer from './RealTimeChartContainer'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="en">{ui}</TranslationProvider>)
}

describe('RealTimeChartContainer', () => {
  it('renders the chart from the fetched value', async () => {
    render(
      <RealTimeChartContainer title="Live responses" fetch={async () => 42} locale="en">
        {(count) => <p>{`count: ${count}`}</p>}
      </RealTimeChartContainer>,
    )

    expect(await screen.findByText('count: 42')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Live responses' })).toBeTruthy()
  })

  it('polls, so the chart follows the data without a reload', async () => {
    vi.useFakeTimers()
    let value = 1
    render(
      <RealTimeChartContainer
        title="Responses"
        intervalMs={3000}
        fetch={async () => {
          value += 1
          return value
        }}
        locale="en"
      >
        {(count) => <p>{`count: ${count}`}</p>}
      </RealTimeChartContainer>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('count: 2')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(screen.getByText('count: 3')).toBeTruthy()
  })

  describe('freshness', () => {
    /**
     * The whole point. Legacy's contribution was a pulsing "LIVE" pill, which is a
     * claim about the transport rather than about the data — it went on pulsing while
     * the endpoint 500ed, because nothing was checking.
     */
    it('states when the data was last successfully fetched', async () => {
      render(
        <RealTimeChartContainer title="Responses" fetch={async () => 1} locale="en">
          {() => <p>chart</p>}
        </RealTimeChartContainer>,
      )
      expect(await screen.findByText(/^Updated at /)).toBeTruthy()
    })

    it('says so before the first update lands', () => {
      render(
        <RealTimeChartContainer
          title="Responses"
          fetch={() => new Promise(() => {})}
          locale="en"
        >
          {() => <p>chart</p>}
        </RealTimeChartContainer>,
      )
      expect(screen.getByText('Not updated yet')).toBeTruthy()
    })

    it('shows a live indicator while updates are landing', async () => {
      render(
        <RealTimeChartContainer title="Responses" fetch={async () => 1} locale="en">
          {() => <p>chart</p>}
        </RealTimeChartContainer>,
      )
      expect(await screen.findByText('Live')).toBeTruthy()
      expect(screen.queryByText('Updates stalled')).toBeNull()
    })

    /** A failed poll keeps the numbers and says they have stopped moving. */
    it('warns that updates stalled while keeping the last good chart', async () => {
      vi.useFakeTimers()
      let attempt = 0
      render(
        <RealTimeChartContainer
          title="Responses"
          intervalMs={3000}
          fetch={async () => {
            attempt += 1
            if (attempt === 1) return 7
            throw new Error('endpoint down')
          }}
          locale="en"
        >
          {(count) => <p>{`count: ${count}`}</p>}
        </RealTimeChartContainer>,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('Live')).toBeTruthy()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(screen.getByText('Updates stalled')).toBeTruthy()
      // The reader keeps the last number they had, rather than the view blanking.
      expect(screen.getByText('count: 7')).toBeTruthy()
    })

    /**
     * A figure changing every few seconds must not interrupt whatever a screen-reader
     * user is currently reading.
     */
    it('announces the timestamp politely, not assertively', async () => {
      const { container } = render(
        <RealTimeChartContainer title="Responses" fetch={async () => 1} locale="en">
          {() => <p>chart</p>}
        </RealTimeChartContainer>,
      )
      await waitFor(() => expect(screen.getByText(/^Updated at /)).toBeTruthy())
      expect(container.querySelector('[aria-live="polite"]')).toBeTruthy()
      expect(container.querySelector('[aria-live="assertive"]')).toBeNull()
    })
  })

  describe('states that are not data', () => {
    it('shows loading before the first result', () => {
      render(
        <RealTimeChartContainer title="Responses" fetch={() => new Promise(() => {})} locale="en">
          {() => <p>chart</p>}
        </RealTimeChartContainer>,
      )
      expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading chart data')
    })

    /**
     * Distinct from empty: "No data" is a claim about the data, and the first fetch
     * failing is a claim about the fetch.
     */
    it('distinguishes a failed first load from an empty result', async () => {
      render(
        <RealTimeChartContainer
          title="Responses"
          fetch={async () => {
            throw new Error('down')
          }}
          locale="en"
        >
          {() => <p>chart</p>}
        </RealTimeChartContainer>,
      )
      expect(await screen.findByText('Could not load the latest data')).toBeTruthy()
      expect(screen.queryByText('No data to display')).toBeNull()
    })

    it('does not poll or claim to be live when disabled', async () => {
      const fetcher = vi.fn(async () => 1)
      render(
        <RealTimeChartContainer title="Responses" fetch={fetcher} enabled={false} locale="en">
          {() => <p>chart</p>}
        </RealTimeChartContainer>,
      )

      await waitFor(() => expect(screen.getByText('Live updates are paused')).toBeTruthy())
      expect(fetcher).not.toHaveBeenCalled()
      expect(screen.queryByText('Live')).toBeNull()
    })

    it('uses a caller-supplied reason for being paused', async () => {
      render(
        <RealTimeChartContainer
          title="Responses"
          fetch={async () => 1}
          enabled={false}
          disabledMessage="This microclimate has closed"
          locale="en"
        >
          {() => <p>chart</p>}
        </RealTimeChartContainer>,
      )
      expect(await screen.findByText('This microclimate has closed')).toBeTruthy()
    })
  })

  /** A reader who suspects the number is stale should not have to reload the page. */
  it('re-fetches on demand', async () => {
    const fetcher = vi.fn(async () => 1)
    render(
      <RealTimeChartContainer title="Responses" fetch={fetcher} locale="en">
        {() => <p>chart</p>}
      </RealTimeChartContainer>,
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  })

  /** The interval contract is enforced in `usePolling`; this checks it reaches here. */
  it('refuses an interval outside the 3-5s range', () => {
    expect(() =>
      render(
        <RealTimeChartContainer title="Responses" fetch={async () => 1} intervalMs={250} locale="en">
          {() => <p>chart</p>}
        </RealTimeChartContainer>,
      ),
    ).toThrow(RangeError)
  })
})
