import { describe, it, expect } from 'vitest'
import {
  CLOSING_SOON_DAYS,
  belongsToNoCompany,
  daysUntilClose,
  groupMySurveys,
  isClosingSoon,
  roleLabelKey,
  type MySurveyRow,
} from './derive'
import type { CompanyScope } from '../../../../company-context'
import type { MySurveyListItem } from '../../api/surveys'

/**
 * The pure half of `/surveys/my`. Every date here is a UTC midnight because that is what
 * `Survey.EndDate` is — a calendar day, not an instant (`lib/calendarDay.ts`).
 */

const DAY = 86_400_000
/** 10 Sep 2026, 21:50 in Costa Rica — the canvas's evening, 03:50 UTC on the 11th. */
const NOW = Date.parse('2026-09-11T03:50:00.000Z')

function item(overrides: Partial<MySurveyListItem> = {}): MySurveyListItem {
  return {
    id: 's1',
    title: 'Encuesta de Clima Q4 (abierta)',
    description: null,
    type: 'periodic',
    startDate: '2026-09-03T02:03:39.148+00:00',
    endDate: '2026-10-10T02:03:39.148+00:00',
    questionCount: 6,
    anonymous: true,
    timeLimitMinutes: null,
    ...overrides,
  }
}

function scope(overrides: Partial<CompanyScope> = {}): CompanyScope {
  return {
    role: 'employee',
    isSuperAdmin: false,
    status: 'ready',
    companyId: '16c97c29-07f8-4522-86fc-e6cc56298829',
    ...overrides,
  }
}

function row(daysLeft: number | null): MySurveyRow {
  return {
    id: 's1',
    name: null,
    questionCount: 6,
    minutes: 4,
    underAMinute: false,
    closesAt: '2026-10-10T02:03:39.148+00:00',
    daysLeft,
  }
}

describe('daysUntilClose', () => {
  it('counts whole calendar days, so the hour of the run cannot move the answer', () => {
    // 11 Sep 03:50 UTC to 10 Oct 02:03 UTC is 28.9 elapsed days; the calendar days
    // between the two dates are 29. Counting milliseconds would print one fewer.
    expect(daysUntilClose('2026-10-10T02:03:39.148+00:00', NOW)).toBe(29)
  })

  it('reads a survey closing on today’s own day as zero, not as one', () => {
    expect(daysUntilClose('2026-09-11T23:59:00.000Z', NOW)).toBe(0)
  })

  it('goes negative once the window has passed', () => {
    expect(daysUntilClose(new Date(NOW - 8 * DAY).toISOString(), NOW)).toBe(-8)
  })

  it('answers null for a date it cannot parse, rather than a guessed countdown', () => {
    expect(daysUntilClose('not a date', NOW)).toBeNull()
  })
})

describe('groupMySurveys', () => {
  it('keeps a survey closing today open — it has not closed until the day is past', () => {
    const { open, closed } = groupMySurveys([item({ endDate: '2026-09-11T23:59:00.000Z' })], NOW)
    expect(open.map((entry) => entry.id)).toEqual(['s1'])
    expect(closed).toEqual([])
  })

  it('moves a survey whose window has ended into the closed group', () => {
    const { open, closed } = groupMySurveys(
      [
        item({ id: 'open', endDate: '2026-10-10T02:03:39.148+00:00' }),
        item({ id: 'past', endDate: new Date(NOW - 8 * DAY).toISOString() }),
      ],
      NOW,
    )
    expect(open.map((entry) => entry.id)).toEqual(['open'])
    expect(closed.map((entry) => entry.id)).toEqual(['past'])
  })

  it('treats an unparseable date as open, which is the safer side of the guess', () => {
    const { open, closed } = groupMySurveys([item({ endDate: 'not a date' })], NOW)
    expect(open.map((entry) => entry.daysLeft)).toEqual([null])
    expect(closed).toEqual([])
  })

  it('computes the reading, never takes it from the payload', () => {
    // Six questions is four minutes at `respondEstimate`'s two thirds of a minute each —
    // the figure Home and the respond page both print for the same survey.
    const [six] = groupMySurveys([item({ questionCount: 6 })], NOW).open
    expect(six.minutes).toBe(4)
    expect(six.underAMinute).toBe(false)

    const [one] = groupMySurveys([item({ questionCount: 1 })], NOW).open
    expect(one.underAMinute).toBe(true)
  })

  it('keeps the server’s order, which is soonest to close first', () => {
    const rows = groupMySurveys(
      [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })],
      NOW,
    ).open
    expect(rows.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('isClosingSoon', () => {
  it('lights up a row inside the week and leaves the one beyond it plain', () => {
    expect(isClosingSoon(row(CLOSING_SOON_DAYS))).toBe(true)
    expect(isClosingSoon(row(CLOSING_SOON_DAYS + 1))).toBe(false)
  })

  it('says nothing about a row with no countdown at all', () => {
    expect(isClosingSoon(row(null))).toBe(false)
  })
})

describe('belongsToNoCompany', () => {
  it('is true for a super administrator whichever tenant they are browsing', () => {
    // `User.CompanyId` is NULL for a global super_admin (#191), so `/surveys/my` is empty
    // for them however `resolveCompanyScope` reports the selection they administer.
    expect(belongsToNoCompany(scope({ isSuperAdmin: true, status: 'needs-selection', companyId: undefined }))).toBe(true)
    expect(belongsToNoCompany(scope({ isSuperAdmin: true, status: 'ready' }))).toBe(true)
  })

  it('is true for any other role whose token names no tenant', () => {
    expect(belongsToNoCompany(scope({ role: 'leader', status: 'no-company', companyId: undefined }))).toBe(true)
  })

  it('is false for the reader the page is actually for', () => {
    expect(belongsToNoCompany(scope())).toBe(false)
    expect(belongsToNoCompany(scope({ role: 'supervisor' }))).toBe(false)
  })
})

describe('roleLabelKey', () => {
  it('names the three roles this page is loadable by', () => {
    expect(roleLabelKey('employee')).toBe('users.employee')
    expect(roleLabelKey('leader')).toBe('users.leader')
    expect(roleLabelKey('supervisor')).toBe('users.supervisor')
  })

  it('guesses no word for a role it does not know, and none for no role at all', () => {
    expect(roleLabelKey('auditor')).toBeNull()
    expect(roleLabelKey(undefined)).toBeNull()
  })
})
