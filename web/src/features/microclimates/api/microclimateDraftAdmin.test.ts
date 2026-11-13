import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setToken } from '../../../auth/token'
import { deleteMicroclimate, getMicroclimateSeats, replaceMicroclimateContent } from './microclimates'
import { INVITATION_PAGE_SIZE, listAllMicroclimateInvitations } from './microclimateInvitations'

const baseUrl = 'http://api.test'

function row(n: number) {
  return { id: `i${n}`, email: `p${n}@meridiano.test`, status: 'pending' }
}

function page(rows: number[], total: number) {
  return new Response(
    JSON.stringify({
      invitations: rows.map(row),
      summary: { total, pending: total, sent: 0, opened: 0, started: 0, completed: 0, revoked: 0, expired: 0 },
      anonymity: { anonymous: true, highestRecordableState: 'opened', suppressedStates: [], guarantee: '' },
    }),
    { status: 200 },
  )
}

const range = (from: number, count: number) => Array.from({ length: count }, (_, index) => from + index)

describe('the microclimate admin routes of G23', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('replaces a draft’s content with PUT /content, the dates in UTC and a timezone', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'm1' }), { status: 200 }))
    await replaceMicroclimateContent(
      baseUrl,
      'm1',
      { title: 'Pulso', startTime: '2026-10-23T09:00', endTime: '2026-10-23T11:00', targetParticipantCount: 8, anonymousResponses: true, questions: [], language: 'es' },
      'es',
    )
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe(`${baseUrl}/microclimates/m1/content?lang=es`)
    expect(init?.method).toBe('PUT')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.startTime).toBe(new Date('2026-10-23T09:00').toISOString())
    expect(body.timezone).toBeTruthy()
    expect(body).not.toHaveProperty('companyId')
    expect(body).not.toHaveProperty('templateId')
  })

  it('discards a draft with DELETE and reads the seats of a named company', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ licensed: true, status: 'active', seatsTotal: 5, seatsUsed: 2, seatsRemaining: 3 }), { status: 200 }))
    await deleteMicroclimate(baseUrl, 'm1')
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(`${baseUrl}/microclimates/m1`)
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBe('DELETE')
    expect((await getMicroclimateSeats(baseUrl, 'c1')).seatsRemaining).toBe(3)
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe(`${baseUrl}/microclimates/seats?companyId=c1`)
  })

  it('reads every page of the invitation list, by offset, until it holds the total', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(page(range(0, INVITATION_PAGE_SIZE), 1003))
      .mockResolvedValueOnce(page(range(500, INVITATION_PAGE_SIZE), 1003))
      .mockResolvedValueOnce(page(range(1000, 3), 1003))
    const list = await listAllMicroclimateInvitations(baseUrl, 'm1')
    expect(list.invitations).toHaveLength(1003)
    expect(new Set(list.invitations.map((invitation) => invitation.id)).size).toBe(1003)
    expect(vi.mocked(fetch).mock.calls.map((call) => call[0])).toEqual([
      `${baseUrl}/microclimates/m1/invitations`,
      `${baseUrl}/microclimates/m1/invitations?offset=500`,
      `${baseUrl}/microclimates/m1/invitations?offset=1000`,
    ])
  })

  it('reads one page when one page is the whole list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(page(range(0, 12), 12))
    expect((await listAllMicroclimateInvitations(baseUrl, 'm1')).invitations).toHaveLength(12)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
