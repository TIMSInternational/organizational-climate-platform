import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  SURVEY_INVITATION_PROGRESSION,
  SURVEY_INVITATION_STATUSES,
  createSurveyInvitations,
  getSurveyDistribution,
  isKnownInvitationStatus,
  isSuppressedForAnonymity,
  listSurveyInvitations,
  outstandingInvitations,
  regenerateSurveyLink,
  resendSurveyInvitation,
  revokeSurveyInvitation,
  revokeSurveyLink,
  sendSurveyReminders,
  updateSurveyDistribution,
  type SurveyInvitationDetail,
} from './surveyDistribution'

const BASE_URL = 'http://localhost:5080'

function invitation(overrides: Partial<SurveyInvitationDetail>): SurveyInvitationDetail {
  return {
    id: 'i1',
    surveyId: 's1',
    userId: 'u1',
    email: 'someone@acme.com',
    status: 'sent',
    isExpired: false,
    sentAt: '2026-08-01T09:00:00Z',
    openedAt: null,
    startedAt: null,
    completedAt: null,
    reminderCount: 0,
    lastReminderSent: null,
    expiresAt: '2026-09-01T09:00:00Z',
    createdAt: '2026-08-01T08:00:00Z',
    ...overrides,
  }
}

function stubFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('survey distribution API client', () => {
  beforeEach(() => {
    localStorage.setItem('climate_platform_token', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('reads the distribution for a survey', async () => {
    const fetchMock = stubFetch({ id: 'd1', surveyId: 's1', publicLink: null })

    await getSurveyDistribution(BASE_URL, 's1')

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/surveys/s1/distribution`)
  })

  it('upserts the distribution with PUT', async () => {
    const fetchMock = stubFetch({ id: 'd1' })

    await updateSurveyDistribution(BASE_URL, 's1', { accessType: 'public' })

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/surveys/s1/distribution`)
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ accessType: 'public' })
  })

  it('posts to the two link routes', async () => {
    const fetchMock = stubFetch({ id: 'd1' })

    await regenerateSurveyLink(BASE_URL, 's1')
    await revokeSurveyLink(BASE_URL, 's1')

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/surveys/s1/distribution/link/regenerate`)
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE_URL}/surveys/s1/distribution/link/revoke`)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('lists invitations, with the status filter pushed to the server', async () => {
    const fetchMock = stubFetch({ invitations: [], summary: {}, anonymity: {} })

    await listSurveyInvitations(BASE_URL, 's1')
    await listSurveyInvitations(BASE_URL, 's1', { status: 'opened' })

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/surveys/s1/invitations`)
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE_URL}/surveys/s1/invitations?status=opened`)
  })

  it('sends exactly the selector it was given, and nothing else', async () => {
    // The server refuses a request carrying zero or two selectors. A client that
    // helpfully added `allTargeted: false` alongside `userIds` would trip that rule.
    const fetchMock = stubFetch({ requested: 2, created: 2 })

    await createSurveyInvitations(BASE_URL, 's1', { userIds: ['u1', 'u2'] })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ userIds: ['u1', 'u2'] })
  })

  it('posts reminders, resends and revocations to their own routes', async () => {
    const fetchMock = stubFetch({})

    await sendSurveyReminders(BASE_URL, 's1')
    await resendSurveyInvitation(BASE_URL, 's1', 'i9')
    await revokeSurveyInvitation(BASE_URL, 's1', 'i9')

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${BASE_URL}/surveys/s1/invitations/reminders`,
      `${BASE_URL}/surveys/s1/invitations/i9/resend`,
      `${BASE_URL}/surveys/s1/invitations/i9/revoke`,
    ])
  })

  /**
   * The guard that would have caught the #78 defect in this shape: `status` is typed
   * `string` off the wire, so a UI that interpolates it into a translation key renders
   * the raw key path when the server sends something this build has not heard of.
   */
  it('recognises exactly the six statuses it has translations for', () => {
    expect([...SURVEY_INVITATION_STATUSES]).toEqual([
      'pending',
      'sent',
      'opened',
      'started',
      'completed',
      'revoked',
    ])
    expect(isKnownInvitationStatus('opened')).toBe(true)
    expect(isKnownInvitationStatus('bounced')).toBe(false)
  })

  it('keeps revoked off the progression, because it is not progress', () => {
    expect([...SURVEY_INVITATION_PROGRESSION]).not.toContain('revoked')
    // Derived, not restated: the ladder is a prefix of the full set.
    expect([...SURVEY_INVITATION_STATUSES].slice(0, 5)).toEqual([...SURVEY_INVITATION_PROGRESSION])
  })

  describe('outstandingInvitations', () => {
    it('counts sent, opened and started — the set the reminder route acts on', () => {
      const rows = [
        invitation({ id: 'a', status: 'sent' }),
        invitation({ id: 'b', status: 'opened' }),
        invitation({ id: 'c', status: 'started' }),
      ]
      expect(outstandingInvitations(rows).map((row) => row.id)).toEqual(['a', 'b', 'c'])
    })

    it('excludes pending, because nothing has been queued for that person yet', () => {
      // A "reminder" to someone who was never contacted would be the first thing they
      // ever heard about the survey. The server skips them; so does this.
      expect(outstandingInvitations([invitation({ status: 'pending' })])).toHaveLength(0)
    })

    it('excludes completed, revoked and expired', () => {
      const rows = [
        invitation({ id: 'a', status: 'completed' }),
        invitation({ id: 'b', status: 'revoked' }),
        invitation({ id: 'c', status: 'sent', isExpired: true }),
      ]
      expect(outstandingInvitations(rows)).toHaveLength(0)
    })
  })

  describe('isSuppressedForAnonymity', () => {
    const anonymous = {
      anonymous: true,
      highestRecordableState: 'opened',
      suppressedStates: ['started', 'completed'],
      guarantee: 'Tracking stops at opened.',
    }

    it('reads the suppressed set off the payload rather than recomputing it', () => {
      expect(isSuppressedForAnonymity(anonymous, 'completed')).toBe(true)
      expect(isSuppressedForAnonymity(anonymous, 'opened')).toBe(false)
    })

    it('trusts the server when the ceiling moves', () => {
      // The point of reading the list rather than branching on `anonymous`: a server that
      // lowers the ceiling to `sent` is honoured without a client release.
      const stricter = { ...anonymous, highestRecordableState: 'sent', suppressedStates: ['opened', 'started', 'completed'] }
      expect(isSuppressedForAnonymity(stricter, 'opened')).toBe(true)
    })

    it('suppresses nothing for a non-anonymous survey', () => {
      const named = { anonymous: false, highestRecordableState: 'completed', suppressedStates: [], guarantee: '' }
      expect(isSuppressedForAnonymity(named, 'completed')).toBe(false)
    })
  })
})
