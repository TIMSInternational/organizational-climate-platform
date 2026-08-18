import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TranslationProvider } from '../../i18n'
import DistributionProgress from './DistributionProgress'
import type {
  SurveyAnonymityGuarantee,
  SurveyInvitationSummary,
} from '../../features/surveys/api/surveyDistribution'

afterEach(cleanup)

const SUMMARY: SurveyInvitationSummary = {
  total: 12,
  pending: 1,
  sent: 4,
  opened: 2,
  started: 1,
  completed: 3,
  revoked: 1,
  expired: 0,
}

const NAMED: SurveyAnonymityGuarantee = {
  anonymous: false,
  highestRecordableState: 'completed',
  suppressedStates: [],
  guarantee: 'Tracking runs to completion.',
}

const ANONYMOUS: SurveyAnonymityGuarantee = {
  anonymous: true,
  highestRecordableState: 'opened',
  suppressedStates: ['started', 'completed'],
  guarantee: 'Tracking stops at opened.',
}

function renderProgress(
  anonymity: SurveyAnonymityGuarantee,
  responseCount: number,
  remindersSent: number | null = 0,
) {
  return render(
    <TranslationProvider>
      <DistributionProgress
        summary={SUMMARY}
        anonymity={anonymity}
        responseCount={responseCount}
        remindersSent={remindersSent}
      />
    </TranslationProvider>,
  )
}

/**
 * Reads the value out of the `KpiTile` carrying a given label.
 *
 * The readings moved from a `<dl>` to the redesign's KPI strip, so this walks to the
 * tile by its `data-slot` — the same handle the other strip tests use — and takes the
 * value element rather than matching on a class that is free to change.
 */
function statFor(label: string): string {
  const tile = screen.getByText(label).closest('[data-slot="kpi-tile"]')
  return tile?.children[1]?.textContent ?? ''
}

describe('DistributionProgress', () => {
  it('reports invited, responded and outstanding for a named survey', () => {
    renderProgress(NAMED, 3)

    expect(statFor('Invited')).toBe('12')
    expect(statFor('Responded')).toBe('3')
    // sent + opened + started. `pending` is excluded: no notification has been queued for
    // those people, so nobody is waiting on them yet — the same set the reminder route acts on.
    expect(statFor('Outstanding')).toBe('7')
  })

  /**
   * The defect this component exists to avoid.
   *
   * For an anonymous survey `summary.completed` is a structural zero — the API never
   * writes `completed_at` against an individual. Rendering it as a completion count would
   * report "0 responded" for a survey with real responses, which is worse than showing
   * nothing: it is a wrong number with a progress bar attached.
   */
  it('uses the aggregate response count, not the suppressed per-person one, when anonymous', () => {
    // The suppressed summary still carries a `completed` of 3 — this asserts the
    // component ignores it rather than that the server zeroed it.
    renderProgress(ANONYMOUS, 9)

    expect(statFor('Responses received')).toBe('9')
    expect(screen.queryByText('Responded')).toBeNull()
  })

  it('explains why the number is an aggregate rather than leaving a gap', () => {
    renderProgress(ANONYMOUS, 9)

    expect(
      screen.getByText(/anonymous, so responses are counted in total only/i),
    ).toBeTruthy()
  })

  it('says nothing about anonymity when the survey is not anonymous', () => {
    const { container } = renderProgress(NAMED, 3)
    expect(container.textContent).not.toMatch(/anonymous/i)
  })

  it('exposes the bar to assistive tech with a real percentage', () => {
    renderProgress(NAMED, 3)

    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('25')
    expect(bar.getAttribute('aria-label')).toBe('Share of invitees who have responded')
  })

  it('does not divide by zero before anyone is invited', () => {
    render(
      <TranslationProvider>
        <DistributionProgress
          summary={{ ...SUMMARY, total: 0, completed: 0 }}
          anonymity={NAMED}
          responseCount={0}
          remindersSent={0}
        />
      </TranslationProvider>,
    )

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
  })

  it('labels every number, so no figure stands alone', () => {
    const { container } = renderProgress(NAMED, 3)
    const tiles = container.querySelectorAll('[data-slot="kpi-tile"]')
    expect(tiles).toHaveLength(4)
    for (const tile of tiles) {
      expect(tile.children[0]?.textContent?.trim()).toBeTruthy()
    }
  })

  /**
   * A reminder count of `null` means the invitation list has not arrived. Printing `0`
   * there would assert that none were sent, which is a different statement from "not
   * known yet" — the em dash is `KpiTile`'s way of saying the second.
   */
  it('shows an em dash, not a zero, when the reminder count is unknown', () => {
    renderProgress(NAMED, 3, null)
    expect(statFor('Reminders sent')).toBe('\u2014')
  })

  /**
   * The server authors one sentence describing how far tracking goes for this survey.
   * It was never rendered in this client; the participation section is where it belongs.
   */
  it('renders the guarantee sentence the server wrote', () => {
    renderProgress(NAMED, 3)
    expect(screen.getByText('Tracking runs to completion.')).toBeTruthy()
  })
})
