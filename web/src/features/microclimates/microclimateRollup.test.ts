import { describe, it, expect } from 'vitest'
import { liveSessions, rollUpMicroclimates } from './microclimateRollup'
import type { Microclimate } from './api/microclimates'

function session(overrides: Partial<Microclimate> = {}): Microclimate {
  return {
    id: 'm1',
    title: 'Ops all-hands',
    companyId: 'c1',
    status: 'active',
    language: 'en',
    responseCount: 0,
    targetParticipantCount: 10,
    createdAt: '2026-08-01T09:00:00Z',
    ...overrides,
  }
}

describe('rollUpMicroclimates', () => {
  it('counts each status separately and totals every response', () => {
    const rollup = rollUpMicroclimates([
      session({ id: '1', status: 'active', responseCount: 31 }),
      session({ id: '2', status: 'active', responseCount: 3 }),
      session({ id: '3', status: 'closed', responseCount: 51 }),
      session({ id: '4', status: 'draft', responseCount: 0 }),
    ])

    expect(rollup.live).toBe(2)
    expect(rollup.closed).toBe(1)
    expect(rollup.draft).toBe(1)
    expect(rollup.responses).toBe(85)
  })

  it('sums responses from every session, not only the open ones', () => {
    // The reading is "what this company has collected", so a closed session's
    // responses are part of it. Counting only the live ones would make the number
    // fall to zero the moment the last session closed.
    const rollup = rollUpMicroclimates([
      session({ id: '1', status: 'closed', responseCount: 40 }),
      session({ id: '2', status: 'draft', responseCount: 2 }),
    ])
    expect(rollup.responses).toBe(42)
    expect(rollup.live).toBe(0)
  })

  it('reads an empty listing as four zeroes', () => {
    expect(rollUpMicroclimates([])).toEqual({ live: 0, draft: 0, closed: 0, responses: 0 })
  })
})

describe('liveSessions', () => {
  it('returns only the sessions still taking responses', () => {
    const live = liveSessions([
      session({ id: 'open', status: 'active' }),
      session({ id: 'shut', status: 'closed' }),
      session({ id: 'unopened', status: 'draft' }),
    ])

    expect(live.map((s) => s.id)).toEqual(['open'])
  })

  it('orders them newest first', () => {
    const live = liveSessions([
      session({ id: 'older', createdAt: '2026-08-01T09:00:00Z' }),
      session({ id: 'newest', createdAt: '2026-08-10T09:00:00Z' }),
      session({ id: 'middle', createdAt: '2026-08-05T09:00:00Z' }),
    ])

    expect(live.map((s) => s.id)).toEqual(['newest', 'middle', 'older'])
  })

  it('leaves the array it was given untouched', () => {
    // `Array.prototype.sort` mutates. The argument here is the state array the
    // page renders its table from, so sorting in place would silently reorder the
    // table as a side effect of drawing the panel above it.
    const sessions = [
      session({ id: 'older', createdAt: '2026-08-01T09:00:00Z' }),
      session({ id: 'newest', createdAt: '2026-08-10T09:00:00Z' }),
    ]

    liveSessions(sessions)

    expect(sessions.map((s) => s.id)).toEqual(['older', 'newest'])
  })
})
