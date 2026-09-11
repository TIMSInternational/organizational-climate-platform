import { describe, expect, it } from 'vitest'
import type { Microclimate, Question, WordCloudEntry } from '../api/microclimates'
import {
  clock,
  dayMonth,
  dayMonthLong,
  displayLink,
  fillPercent,
  flowStepOf,
  groupSessions,
  questionKinds,
  respondUrl,
  sessionReference,
  shortTitle,
  stamp,
  wordBars,
} from './derive'

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

describe('wordBars', () => {
  const words = [word('carga', 4), word('apoyo', 7), word('visa', 1), word('equipo', 7), word('turnos', 2)]

  it('draws no bar at all under the floor of 5, however many words there are', () => {
    const bars = wordBars(words, 4)
    expect(bars.isSuppressed).toBe(true)
    expect(bars.bars).toEqual([])
  })

  it('above the floor, drops the rare words and reports them, and sorts by frequency', () => {
    const bars = wordBars(words, 5)
    expect(bars.isSuppressed).toBe(false)
    // "visa" was written once: held back, and counted so the total reconciles.
    expect(bars.bars.map((b) => b.text)).toEqual(['apoyo', 'equipo', 'carga', 'turnos'])
    expect(bars.withheldCount).toBe(1)
    expect(bars.bars.map((b) => b.share)).toEqual([1, 1, 4 / 7, 2 / 7])
  })

  it('draws at most the top eight', () => {
    const many = Array.from({ length: 12 }, (_, index) => word(`w${String(index).padStart(2, '0')}`, 20 - index))
    expect(wordBars(many, 9).bars.map((b) => b.text)).toEqual(['w00', 'w01', 'w02', 'w03', 'w04', 'w05', 'w06', 'w07'])
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
