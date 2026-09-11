import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_MS,
  barPosition,
  belowFloor,
  countTicks,
  defaultWindow,
  figureKind,
  invitationLadder,
  journeyStates,
  newestFirst,
  outstanding,
  toLocalInput,
  typeCounts,
  windowLength,
  windowMs,
  wordBars,
} from './derive'
import type { Microclimate } from '../api/microclimates'

describe('the floor', () => {
  it('withholds under 5 and opens at 5 — the platform floor, not a local number', () => {
    expect(belowFloor(0)).toBe(true)
    expect(belowFloor(4)).toBe(true)
    expect(belowFloor(5)).toBe(false)
  })
})

describe('the bar', () => {
  it('places a count on a 0..target bar and clamps it', () => {
    expect(barPosition(5, 20)).toBe(25)
    expect(barPosition(0, 20)).toBe(0)
    expect(barPosition(30, 20)).toBe(100)
  })

  it('has no position with nothing expected — a rate against zero is invented', () => {
    expect(barPosition(3, 0)).toBeNull()
  })

  it('never reports a negative outstanding count', () => {
    expect(outstanding(0, 20)).toBe(20)
    expect(outstanding(25, 20)).toBe(0)
  })

  it('labels the 20-expected axis the board draws: 0 5 10 15 20', () => {
    expect(countTicks(20)).toEqual([0, 5, 10, 15, 20])
  })

  it('ends every axis on its maximum without two labels colliding', () => {
    expect(countTicks(23)).toEqual([0, 5, 10, 15, 20, 23])
    expect(countTicks(21)).toEqual([0, 5, 10, 15, 21])
    expect(countTicks(0)).toEqual([0])
  })
})

describe('the journey', () => {
  it('reads a live session as created and being shared', () => {
    expect(journeyStates('active')).toEqual({ create: 'done', share: 'current', live: 'pending', read: 'pending' })
  })

  it('reads a draft as still being created and a closed session as ready to read', () => {
    expect(journeyStates('draft').create).toBe('current')
    expect(journeyStates('closed')).toEqual({ create: 'done', share: 'done', live: 'done', read: 'current' })
  })

  it('claims nothing for a status it does not know', () => {
    expect(Object.values(journeyStates('archived'))).toEqual(['pending', 'pending', 'pending', 'pending'])
  })
})

describe('questions', () => {
  it('draws open text as words and everything else as columns', () => {
    expect(figureKind('open_ended')).toBe('words')
    expect(figureKind('likert')).toBe('scale')
    expect(figureKind('yes_no')).toBe('choice')
  })

  it('counts types in first-appearance order — "una escala, una palabra"', () => {
    expect(typeCounts([{ type: 'likert' }, { type: 'open_ended' }, { type: 'likert' }])).toEqual([
      { type: 'likert', count: 2 },
      { type: 'open_ended', count: 1 },
    ])
  })
})

describe('the words', () => {
  const words = [
    { text: 'carga', value: 4, language: 'es' },
    { text: 'visa', value: 1, language: 'es' },
    { text: 'apoyo', value: 4, language: 'es' },
    { text: 'tiempo', value: 2, language: 'es' },
  ]

  it('shows nothing of a session under the floor, and says how much it withheld', () => {
    const bars = wordBars(words, 4)
    expect(bars.suppressed).toBe(true)
    expect(bars.words).toEqual([])
    expect(bars.withheld).toBe(4)
  })

  it('at the floor drops a word said once, most frequent first and alphabetical among equals', () => {
    const bars = wordBars(words, 5)
    expect(bars.suppressed).toBe(false)
    expect(bars.words.map((word) => word.text)).toEqual(['apoyo', 'carga', 'tiempo'])
    expect(bars.withheld).toBe(1)
  })
})

describe('the invitation ladder', () => {
  it('stops an anonymous session at opened and strikes started and completed', () => {
    expect(
      invitationLadder({ highestRecordableState: 'opened', suppressedStates: ['started', 'completed'] }),
    ).toEqual({ recorded: ['pending', 'sent', 'opened'], suppressed: ['started', 'completed'] })
  })

  it('records every rung for a signed-in session', () => {
    expect(invitationLadder({ highestRecordableState: 'completed', suppressedStates: [] }).recorded).toEqual([
      'pending',
      'sent',
      'opened',
      'started',
      'completed',
    ])
  })
})

describe('the schedule a new session starts with', () => {
  it('opens at the current quarter hour, never in the future, and copies the previous window — 48 hours on the tenant', () => {
    const now = new Date(2026, 8, 10, 21, 7)
    const previous = { startTime: '2026-09-10T02:06:08.991+00:00', endTime: '2026-09-12T02:06:08.992+00:00' }
    const { start, end } = defaultWindow(now, previous)
    expect(toLocalInput(start)).toBe('2026-09-10T21:00')
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime())
    expect(end.getTime() - start.getTime()).toBe(Date.parse(previous.endTime) - Date.parse(previous.startTime))
  })

  it('falls back to 48 hours with no previous session, or an unusable one', () => {
    const now = new Date(2026, 8, 10, 9, 0)
    expect(defaultWindow(now).end.getTime() - defaultWindow(now).start.getTime()).toBe(DEFAULT_WINDOW_MS)
    const backwards = { startTime: '2026-09-12T00:00:00Z', endTime: '2026-09-10T00:00:00Z' }
    expect(defaultWindow(now, backwards).end.getTime() - defaultWindow(now, backwards).start.getTime()).toBe(DEFAULT_WINDOW_MS)
  })

  it('measures a window only when both ends parse and are in order', () => {
    expect(windowMs('2026-09-14T08:00', '2026-09-16T08:00')).toBe(48 * 3_600_000)
    expect(windowMs('2026-09-16T08:00', '2026-09-14T08:00')).toBeNull()
    expect(windowMs('', '2026-09-14T08:00')).toBeNull()
    expect(windowLength(48 * 3_600_000)).toEqual({ unit: 'hours', value: 48 })
    expect(windowLength(30 * 60_000)).toEqual({ unit: 'minutes', value: 30 })
  })
})

describe('the session order', () => {
  it('puts the newest first without touching the caller’s array', () => {
    const older = { id: 'a', createdAt: '2026-09-01T00:00:00Z' } as Microclimate
    const newer = { id: 'b', createdAt: '2026-09-09T00:00:00Z' } as Microclimate
    const input = [older, newer]
    expect(newestFirst(input).map((session) => session.id)).toEqual(['b', 'a'])
    expect(input.map((session) => session.id)).toEqual(['a', 'b'])
  })
})
