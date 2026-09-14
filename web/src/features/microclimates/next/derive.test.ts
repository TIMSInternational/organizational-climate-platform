import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_MS,
  barPosition,
  belowFloor,
  clock,
  countTicks,
  dayMonth,
  dayMonthLong,
  defaultWindow,
  displayLink,
  figureKind,
  fillPercent,
  flowStepOf,
  groupSessions,
  invitationLadder,
  journeyStates,
  liveWordBars,
  newestFirst,
  outstanding,
  questionKinds,
  respondUrl,
  sessionReference,
  shortTitle,
  stamp,
  toLocalInput,
  typeCounts,
  windowLength,
  windowMs,
  wordBars,
} from './derive'
import type { Microclimate, Question, WordCloudEntry } from '../api/microclimates'

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

  it('honours the ceiling on its own: nothing past highestRecordableState, even with nothing suppressed', () => {
    expect(invitationLadder({ highestRecordableState: 'sent', suppressedStates: [] })).toEqual({
      recorded: ['pending', 'sent'],
      suppressed: [],
    })
  })

  it('honours the suppressed list on its own: a suppressed rung under the ceiling is still struck', () => {
    expect(invitationLadder({ highestRecordableState: 'completed', suppressedStates: ['opened'] })).toEqual({
      recorded: ['pending', 'sent', 'started', 'completed'],
      suppressed: ['opened'],
    })
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

/* --- the list and the live session: `redesign/microclimates`'s own block, unchanged but
 * for `wordBars` -> `liveWordBars`, the one name the two lanes both took. --- */

function row(overrides: Partial<Microclimate> = {}): Microclimate {
  return {
    id: 'm',
    title: 'Pulse',
    companyId: 'c',
    status: 'active',
    language: 'es',
    responseCount: 0,
    targetParticipantCount: 20,
    createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function question(overrides: Partial<Question> = {}): Question {
  return { id: 'q', text: 'Q', type: 'likert', options: null, required: true, order: 0, ...overrides }
}

function word(text: string, value: number): WordCloudEntry {
  return { text, value, language: 'es' }
}

describe('groupSessions', () => {
  it('puts open sessions first, then drafts, each newest first, and every other status in the past', () => {
    const rows = [
      row({ id: 'old-open', status: 'active', createdAt: '2026-08-01T00:00:00Z' }),
      row({ id: 'draft', status: 'draft', createdAt: '2026-09-09T00:00:00Z' }),
      row({ id: 'shut', status: 'closed', createdAt: '2026-07-01T00:00:00Z' }),
      row({ id: 'new-open', status: 'active', createdAt: '2026-09-10T00:00:00Z' }),
      row({ id: 'newer-shut', status: 'closed', createdAt: '2026-08-15T00:00:00Z' }),
      row({ id: 'odd', status: 'archived', createdAt: '2026-06-01T00:00:00Z' }),
    ]
    const before = rows.map((r) => r.id)

    const { inProgress, past } = groupSessions(rows)

    expect(inProgress.map((r) => r.id)).toEqual(['new-open', 'old-open', 'draft'])
    // A status the page does not know lands in the past, never nowhere.
    expect(past.map((r) => r.id)).toEqual(['newer-shut', 'shut', 'odd'])
    // The caller's array is the page state; sorting it in place would reorder the source.
    expect(rows.map((r) => r.id)).toEqual(before)
  })
})

describe('flowStepOf', () => {
  it('puts a draft at Crear, an open session at Ver en vivo and a closed one at Leer', () => {
    expect(flowStepOf('draft')).toBe(1)
    expect(flowStepOf('active')).toBe(3)
    expect(flowStepOf('closed')).toBe(4)
    expect(flowStepOf('archived')).toBeNull()
  })
})

describe('shortTitle', () => {
  it('names a session by the title before its dash, as the artboard does', () => {
    expect(shortTitle('Pulso semanal — ¿cómo fue la semana?')).toBe('Pulso semanal')
    expect(shortTitle('Retro – sprint 12')).toBe('Retro')
    expect(shortTitle('Sin guion')).toBe('Sin guion')
    // A title that starts with its dash keeps the whole title rather than naming nothing.
    expect(shortTitle('— sin nombre')).toBe('— sin nombre')
  })
})

describe('sessionReference', () => {
  it('names a session by its noun behind its article in Spanish, as the artboard does', () => {
    expect(sessionReference('Pulso semanal — ¿cómo fue la semana?', 'es')).toEqual({
      kind: 'noun',
      gender: 'masculine',
      phrase: 'pulso semanal',
    })
    expect(sessionReference('Encuesta relámpago — cierre de mes', 'es')).toEqual({
      kind: 'noun',
      gender: 'feminine',
      phrase: 'encuesta relámpago',
    })
    // Only the first letter moves: a department named later keeps its capital.
    expect(sessionReference('Pulso de Operaciones', 'es')).toEqual({
      kind: 'noun',
      gender: 'masculine',
      phrase: 'pulso de Operaciones',
    })
  })

  it('keeps the title for a first word whose article it does not know, rather than guessing one', () => {
    expect(sessionReference('Check-in del lunes', 'es')).toEqual({ kind: 'title', title: 'Check-in del lunes' })
    // Starts like a listed noun, and is not one.
    expect(sessionReference('Retroalimentación trimestral', 'es')).toEqual({
      kind: 'title',
      title: 'Retroalimentación trimestral',
    })
    // A plural does not fit "va por el paso".
    expect(sessionReference('Pulsos del trimestre', 'es')).toEqual({ kind: 'title', title: 'Pulsos del trimestre' })
    // A first word in capitals is not lower-cased into a noun.
    expect(sessionReference('PULSO SEMANAL', 'es')).toEqual({ kind: 'title', title: 'PULSO SEMANAL' })
  })

  it('keeps the title in an English sentence, whose article is not Spanish grammar', () => {
    expect(sessionReference('Pulso semanal — ¿cómo fue la semana?', 'en')).toEqual({
      kind: 'title',
      title: 'Pulso semanal',
    })
  })
})

describe('the respond link', () => {
  it('copies the absolute URL and prints it without the scheme', () => {
    expect(respondUrl('https://climate.timsint.com', 'abc')).toBe('https://climate.timsint.com/microclimates/abc/respond')
    expect(displayLink('https://climate.timsint.com', 'abc')).toBe('climate.timsint.com/microclimates/abc/respond')
  })
})

describe('fillPercent', () => {
  it('invents no denominator and never overfills', () => {
    expect(fillPercent(3, 0)).toBeNull()
    expect(fillPercent(5, 20)).toBe(25)
    // An anonymous link can be answered by more people than were expected.
    expect(fillPercent(30, 20)).toBe(100)
  })
})

describe('questionKinds', () => {
  it('words each question in order, with its scale and whether it may be skipped', () => {
    const kinds = questionKinds([
      question({ id: 'b', type: 'open_ended', required: false, order: 1 }),
      question({ id: 'a', type: 'likert', required: true, order: 0 }),
      question({
        id: 'c',
        type: 'rating',
        order: 2,
        options: [1, 2, 3, 4].map((n) => ({ order: n, value: String(n), label: null })),
      }),
      question({ id: 'd', type: 'something_new', order: 3 }),
    ])

    expect(kinds).toEqual([
      { kindKey: 'microclimates.next.live.kindLikert', count: 0, optional: false },
      { kindKey: 'microclimates.next.live.kindOpenEnded', count: 0, optional: true },
      { kindKey: 'microclimates.next.live.kindScaleOptions', count: 4, optional: false },
      { kindKey: 'microclimates.next.live.kindOther', count: 0, optional: false },
    ])
  })
})

describe('liveWordBars', () => {
  const words = [word('carga', 4), word('apoyo', 7), word('visa', 1), word('equipo', 7), word('turnos', 2)]

  it('draws no bar at all under the floor of 5, however many words there are', () => {
    const bars = liveWordBars(words, 4)
    expect(bars.isSuppressed).toBe(true)
    expect(bars.bars).toEqual([])
  })

  it('above the floor, drops the rare words and reports them, and sorts by frequency', () => {
    const bars = liveWordBars(words, 5)
    expect(bars.isSuppressed).toBe(false)
    // "visa" was written once: held back, and counted so the total reconciles.
    expect(bars.bars.map((b) => b.text)).toEqual(['apoyo', 'equipo', 'carga', 'turnos'])
    expect(bars.withheldCount).toBe(1)
    expect(bars.bars.map((b) => b.share)).toEqual([1, 1, 4 / 7, 2 / 7])
  })

  it('draws at most the top eight', () => {
    const many = Array.from({ length: 12 }, (_, index) => word(`w${String(index).padStart(2, '0')}`, 20 - index))
    expect(liveWordBars(many, 9).bars.map((b) => b.text)).toEqual(['w00', 'w01', 'w02', 'w03', 'w04', 'w05', 'w06', 'w07'])
  })
})

describe('the artboard dates', () => {
  // Built from local components, so the assertion holds in any time zone the suite runs in
  // (CI is UTC, this machine is not): the formatters print the viewer's local time.
  const closes = new Date(2026, 8, 11, 21, 6).toISOString()

  it('prints the list row, the sentence and the facts forms', () => {
    expect(dayMonth(closes, 'es')).toBe('11 sept')
    expect(dayMonthLong(closes, 'es')).toBe('11 de septiembre')
    expect(clock(closes, 'es')).toBe('21:06')
    expect(stamp(closes, 'es')).toBe('11 sept 2026, 21:06')
  })

  it('prints nothing for an unreadable instant rather than "Invalid Date"', () => {
    expect(dayMonth('not a date', 'es')).toBeNull()
    expect(stamp('', 'es')).toBeNull()
  })
})
