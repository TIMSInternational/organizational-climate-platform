import { cleanup, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TranslationProvider } from '../../i18n'
import ParticipationTracker from './ParticipationTracker'

afterEach(cleanup)

function render(ui: ReactElement) {
  return rtlRender(<TranslationProvider initialLocale="en">{ui}</TranslationProvider>)
}

/** Reads the figure out of a `<dt>`/`<dd>` pair by its label. */
function stat(label: string): string {
  const term = screen.getByText(label)
  return term.nextElementSibling?.textContent ?? ''
}

describe('ParticipationTracker', () => {
  it('states responses, invitations and how many are outstanding', () => {
    render(<ParticipationTracker current={40} target={50} locale="en" />)
    expect(stat('Responses')).toBe('40')
    expect(stat('Invited')).toBe('50')
    expect(stat('Outstanding')).toBe('10')
  })

  it('shows the derived rate', () => {
    render(<ParticipationTracker current={40} target={50} locale="en" />)
    expect(screen.getByText('80%')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('80')
  })

  /**
   * The bar is a Radix progressbar, so it carries `role` and `aria-valuenow`. The
   * legacy widget's bar was a bare `<div>` with an animated width -- a coloured box
   * to a screen reader.
   */
  it('exposes the bar to assistive tech with a meaningful name', () => {
    render(<ParticipationTracker current={40} target={50} locale="en" />)
    expect(
      screen.getByRole('progressbar', { name: '40 of 50 invited people have responded' }),
    ).toBeTruthy()
  })

  describe('status banding', () => {
    /** Four labelled bands, so the distinction lives where a reader can read it. */
    it('labels each band', () => {
      render(<ParticipationTracker current={90} target={100} locale="en" />)
      expect(screen.getByText('Excellent')).toBeTruthy()
      cleanup()

      render(<ParticipationTracker current={70} target={100} locale="en" />)
      expect(screen.getByText('Good')).toBeTruthy()
      cleanup()

      render(<ParticipationTracker current={50} target={100} locale="en" />)
      expect(screen.getByText('Fair')).toBeTruthy()
      cleanup()

      render(<ParticipationTracker current={10} target={100} locale="en" />)
      expect(screen.getByText('Low')).toBeTruthy()
    })

    /**
     * Three status colours for four bands. Legacy gave the 60-79 band its own blue,
     * which puts a non-status colour into the status vocabulary.
     */
    it('colours both healthy bands green', () => {
      const excellent = render(<ParticipationTracker current={90} target={100} locale="en" />)
      expect(excellent.container.querySelector('.text-accent-green')).toBeTruthy()
      cleanup()

      const good = render(<ParticipationTracker current={70} target={100} locale="en" />)
      expect(good.container.querySelector('.text-accent-green')).toBeTruthy()
      expect(good.container.querySelector('.text-accent-blue')).toBeNull()
    })

    it('colours fair as a warning and low as critical', () => {
      const fair = render(<ParticipationTracker current={50} target={100} locale="en" />)
      expect(fair.container.querySelector('.text-accent-amber')).toBeTruthy()
      expect(fair.container.querySelector('.bg-accent-amber')).toBeTruthy()
      cleanup()

      const low = render(<ParticipationTracker current={10} target={100} locale="en" />)
      expect(low.container.querySelector('.text-accent-red')).toBeTruthy()
      expect(low.container.querySelector('.bg-accent-red')).toBeTruthy()
    })
  })

  describe('degenerate input', () => {
    /**
     * No target means no denominator. A bar at 0% would claim nobody responded,
     * which is a different statement from "there is nothing to measure against".
     */
    it('says there is no rate rather than showing 0%', () => {
      render(<ParticipationTracker current={12} target={0} locale="en" />)
      expect(screen.queryByRole('progressbar')).toBeNull()
      expect(
        screen.getByText('No invitation total, so there is no response rate to show'),
      ).toBeTruthy()
      // The raw counts are still worth having.
      expect(stat('Responses')).toBe('12')
    })

    /** More responses than invitations means the invite list moved; "-12" reads as a bug. */
    it('never shows a negative outstanding count', () => {
      render(<ParticipationTracker current={60} target={50} locale="en" />)
      expect(stat('Outstanding')).toBe('0')
    })

    /**
     * Regression: the band was computed on the raw ratio while the label showed a
     * rounded one, so 190 of 480 (39.58%) displayed "40%" -- the documented Fair
     * threshold -- while banding as Low. Seen on the chart gallery.
     */
    it('bands on the same figure it displays', () => {
      render(<ParticipationTracker current={190} target={480} locale="en" />)
      expect(screen.getByText('40%')).toBeTruthy()
      expect(screen.getByText('Fair')).toBeTruthy()
      expect(screen.queryByText('Low')).toBeNull()
    })

    it('still bands as low well below the boundary', () => {
      render(<ParticipationTracker current={100} target={480} locale="en" />)
      expect(screen.getByText('21%')).toBeTruthy()
      expect(screen.getByText('Low')).toBeTruthy()
    })

    it('caps the bar at 100% when the rate overshoots', () => {
      render(<ParticipationTracker current={60} target={50} locale="en" />)
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100')
      // The true figure is still stated.
      expect(screen.getByText('120%')).toBeTruthy()
    })
  })

  describe('time remaining', () => {
    it('shows it when given, formatted for the locale', () => {
      render(<ParticipationTracker current={40} target={50} minutesRemaining={150} locale="en" />)
      expect(stat('Time left')).toBe('2 hr 30 min')
    })

    it('omits the figure entirely when there is no deadline', () => {
      render(<ParticipationTracker current={40} target={50} locale="en" />)
      expect(screen.queryByText('Time left')).toBeNull()
    })

    /** Zero is a real value, not an absent one -- the survey closes now. */
    it('shows zero minutes rather than hiding the row', () => {
      render(<ParticipationTracker current={40} target={50} minutesRemaining={0} locale="en" />)
      expect(stat('Time left')).toBe('0 min')
    })
  })

  it('shows loading separately from the data', () => {
    render(<ParticipationTracker current={0} target={50} isLoading locale="en" />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading chart data')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('renders the heading when given one', () => {
    render(<ParticipationTracker current={1} target={2} title="Pulse survey" locale="en" />)
    expect(screen.getByRole('heading', { name: 'Pulse survey' })).toBeTruthy()
  })
})
