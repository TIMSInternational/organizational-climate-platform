import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider } from '../../i18n'
import InvitationTable from './InvitationTable'
import type {
  SurveyAnonymityGuarantee,
  SurveyInvitationDetail,
} from '../../features/surveys/api/surveyDistribution'

afterEach(cleanup)

/**
 * A stand-in for an invitation token: 43 characters, the length of the real base64url
 * ones, but built from a repeated phrase so it carries no entropy. A realistic random
 * string trips the repo's gitleaks hook, and the honest fix is a fixture that is
 * obviously not a credential rather than an allowlist entry that quiets the scanner.
 * Nothing here depends on its randomness — the assertion is that it never appears.
 */
const TOKEN = 'not-a-real-token-not-a-real-token-not-a-real'

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

function invitation(overrides: Partial<SurveyInvitationDetail> = {}): SurveyInvitationDetail {
  return {
    id: 'i1',
    surveyId: 's1',
    userId: 'u1',
    email: 'ada@acme.com',
    status: 'sent',
    isExpired: false,
    sentAt: '2026-08-01T09:00:00Z',
    openedAt: null,
    startedAt: null,
    completedAt: null,
    reminderCount: 2,
    lastReminderSent: '2026-08-03T09:00:00Z',
    expiresAt: '2026-09-01T09:00:00Z',
    createdAt: '2026-08-01T08:00:00Z',
    ...overrides,
  }
}

function renderTable(
  invitations: SurveyInvitationDetail[],
  anonymity: SurveyAnonymityGuarantee,
  handlers: { onResend?: () => void; onRevoke?: () => void } = {},
) {
  return render(
    <TranslationProvider>
      <InvitationTable
        invitations={invitations}
        anonymity={anonymity}
        onResend={handlers.onResend ?? (() => {})}
        onRevoke={handlers.onRevoke ?? (() => {})}
      />
    </TranslationProvider>,
  )
}

describe('InvitationTable', () => {
  /**
   * The single most important assertion in this feature.
   *
   * An invitation token opens the survey as one named employee. The API does not return
   * one, so a test against the real payload could only ever pass vacuously — it would
   * still pass against a component that rendered `row.invitationToken` if such a field
   * ever appeared. So the row here DOES carry tokens, in three plausible spellings, and
   * the assertion is that none of them reaches the DOM.
   *
   * That holds because the component reads named fields rather than iterating the row's
   * keys. Rewrite it to map over `Object.entries(invitation)` and this test fails.
   */
  it('renders no invitation token, even when the payload carries one', () => {
    const leaky = {
      ...invitation(),
      invitationToken: TOKEN,
      token: TOKEN,
      inviteUrl: `https://app.example.com/survey-invitations/${TOKEN}`,
    } as SurveyInvitationDetail

    const { container } = renderTable([leaky], NAMED)

    expect(container.textContent).toContain('ada@acme.com')
    expect(container.textContent).not.toContain(TOKEN)
    expect(container.innerHTML).not.toContain('survey-invitations/')
    // Nor as an attribute — a token in a `title`, `href` or `data-*` is still a token.
    expect(container.innerHTML).not.toContain(TOKEN)
  })

  it('goes through the Table primitive, so a wide table scrolls instead of the page', () => {
    // #218: `w-full` on a table is only safe next to something that scrolls, and only the
    // primitive brings the container with it.
    const { container } = renderTable([invitation()], NAMED)
    expect(container.querySelector('[data-slot="table-container"]')).toBeTruthy()
    expect(container.querySelector('[data-slot="table-container"]')?.className).toContain(
      'overflow-x-auto',
    )
  })

  it('shows the progress columns for a survey that records them', () => {
    renderTable([invitation({ status: 'completed', completedAt: '2026-08-05T10:00:00Z' })], NAMED)

    expect(screen.getByRole('columnheader', { name: 'Started' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Completed' })).toBeTruthy()
  })

  /**
   * For an anonymous survey those two timestamps are never written. An empty cell reads
   * as "this person has not started", which is a claim about a person the survey has
   * promised not to make — so the columns are dropped rather than left permanently blank.
   */
  it('drops the progress columns entirely for an anonymous survey', () => {
    renderTable([invitation()], ANONYMOUS)

    expect(screen.queryByRole('columnheader', { name: 'Started' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Completed' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Invited' })).toBeTruthy()
  })

  it('badges expiry separately from status, because expiry is derived not stored', () => {
    // `isExpired` comes from `expires_at`, so it can be true of a row whose status still
    // says `sent`. Showing only `Sent` there would be misleading.
    renderTable([invitation({ status: 'sent', isExpired: true })], NAMED)

    expect(screen.getByText('Sent')).toBeTruthy()
    expect(screen.getByText('Expired')).toBeTruthy()
  })

  it('shows a status this build has no translation for as-is, never as a key path', () => {
    // #78: interpolating an unvalidated wire value into a translation key renders
    // `surveys.distribution.status.bounced` at the user.
    const { container } = renderTable([invitation({ status: 'bounced' })], NAMED)

    expect(screen.getByText('bounced')).toBeTruthy()
    expect(container.textContent).not.toContain('surveys.distribution.status')
  })

  it('offers resend and revoke, and disables revoke on an already-revoked invitation', async () => {
    const onResend = vi.fn()
    const onRevoke = vi.fn()
    renderTable([invitation({ status: 'revoked' })], NAMED, { onResend, onRevoke })

    expect(screen.getByRole('button', { name: 'Revoke' }).hasAttribute('disabled')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Resend' }))
    expect(onResend).toHaveBeenCalledWith('i1')
  })

  it('says so when nobody has been invited, inside the table body', () => {
    const { container } = renderTable([], NAMED)

    expect(screen.getByText('Nobody has been invited yet.')).toBeTruthy()
    expect(container.querySelector('[data-slot="table-empty"]')).toBeTruthy()
  })
})
