import { describe, expect, it } from 'vitest'
import {
  MAX_REMINDERS,
  daysFrom,
  dimensionSections,
  invitationBuckets,
  launchChecklist,
  maskedLink,
  nextReminder,
  readySteps,
  remindersSent,
  responseRate,
  surveyAudience,
  targetedDepartments,
} from './launch'

const summary = (over: Partial<Record<string, number>> = {}) => ({
  total: 0, pending: 0, sent: 0, opened: 0, started: 0, completed: 0, revoked: 0, expired: 0, ...over,
})

describe('responseRate', () => {
  it('is the whole percent of the stated audience, and null — never 0 — with no audience stated', () => {
    expect(responseRate(3, 24)).toBe(13)
    expect(responseRate(3, null)).toBeNull()
    expect(responseRate(3, 0)).toBeNull()
  })
})

describe('daysFrom', () => {
  it('counts calendar days, ahead positive and behind negative', () => {
    const now = new Date(2026, 8, 10, 23, 0)
    expect(daysFrom(new Date(2026, 9, 10, 1, 0).toISOString(), now)).toBe(30)
    expect(daysFrom(new Date(2026, 8, 10, 1, 0).toISOString(), now)).toBe(0)
    expect(daysFrom(new Date(2026, 8, 7).toISOString(), now)).toBe(-3)
    expect(daysFrom('not a date', now)).toBeNull()
  })
})

describe('targetedDepartments', () => {
  const directory = [
    { id: 'a', name: 'Finanzas' },
    { id: 'b', name: 'Ingeniería' },
    { id: 'c', name: 'Ventas' },
  ] as never[]
  it('names the targeted departments in the directory order and says when one could not be named', () => {
    expect(targetedDepartments(['c', 'a'], directory)).toEqual({ names: ['Finanzas', 'Ventas'], named: true })
    expect(targetedDepartments(['c', 'zz'], directory)).toEqual({ names: ['Ventas'], named: false })
    expect(targetedDepartments(['a'], null)).toEqual({ names: [], named: false })
  })
})

describe('remindersSent', () => {
  it('sums the reminders, and is null — not 0 — while the list is unread', () => {
    expect(remindersSent([{ reminderCount: 2 }, { reminderCount: 1 }] as never[])).toBe(3)
    expect(remindersSent([])).toBe(0)
    expect(remindersSent(null)).toBeNull()
  })
})

describe('invitationBuckets', () => {
  it('counts as sent every invitation that left and was not withdrawn', () => {
    expect(invitationBuckets(summary({ total: 9, pending: 2, sent: 3, opened: 1, started: 1, completed: 1, revoked: 1 }))).toEqual({
      left: 6,
      pending: 2,
      revoked: 1,
    })
  })
})

describe('launchChecklist', () => {
  it('reads the Meridiano Q4 state as 3 of 4: audience and link met, invitations missing, reminders idle', () => {
    const steps = launchChecklist({ audience: 41, publicLink: '/s/abc', summary: summary(), reminders: 0 })
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ['audience', 'done'],
      ['link', 'done'],
      ['invitations', 'missing'],
      ['reminders', 'idle'],
    ])
    expect(readySteps(steps)).toBe(3)
  })

  it('meets the invitations step only when invitations exist and none is pending', () => {
    const state = (s: ReturnType<typeof summary>) =>
      launchChecklist({ audience: 1, publicLink: null, summary: s, reminders: null })[2].state
    expect(state(summary({ total: 4, sent: 4 }))).toBe('done')
    expect(state(summary({ total: 4, sent: 3, pending: 1 }))).toBe('missing')
    expect(state(summary())).toBe('missing')
  })

  it('calls an audience it could not read unknown — never missing, never met — and an empty one missing', () => {
    const unread = launchChecklist({ audience: null, publicLink: null, summary: null, reminders: null })
    expect(unread[0].state).toBe('unknown')
    expect(readySteps(unread)).toBe(1)
    expect(launchChecklist({ audience: 0, publicLink: null, summary: null, reminders: null })[0].state).toBe('missing')
  })

  it('meets the audience step on invitations that went out, even when the directory is unread', () => {
    expect(launchChecklist({ audience: null, publicLink: null, summary: summary({ total: 41, sent: 41 }), reminders: 0 })[0].state).toBe('done')
  })
})

describe('surveyAudience', () => {
  it('prefers the invited, then the directory, then the stated target — and is null, never 0, with none', () => {
    expect(surveyAudience({ invited: 41, resolved: 6, stated: 24 })).toEqual({ count: 41, source: 'invited' })
    expect(surveyAudience({ invited: 0, resolved: 41, stated: 24 })).toEqual({ count: 41, source: 'directory' })
    expect(surveyAudience({ invited: null, resolved: null, stated: 24 })).toEqual({ count: 24, source: 'stated' })
    expect(surveyAudience({ invited: 0, resolved: null, stated: null })).toBeNull()
  })
})

describe('nextReminder (ReminderSchedule.Evaluate over the invitation list)', () => {
  const now = new Date('2026-09-11T12:00:00Z')
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'i', status: 'sent', sentAt: '2026-09-10T15:30:00Z', completedAt: null, reminderCount: 0,
    lastReminderSent: null, expiresAt: '2026-10-10T02:03:39Z', ...over,
  }) as never
  const outlook = (invitations: never[] | null, over: Record<string, unknown> = {}) =>
    nextReminder({ invitations, status: 'active', endDate: '2026-10-10T02:03:39Z', sendReminders: true, frequencyDays: 3, now, ...over })

  it('schedules the first reminder frequencyDays after the invitation went out', () => {
    expect(outlook([row()])).toEqual({ kind: 'scheduled', at: '2026-09-13T15:30:00.000Z' })
  })

  it('anchors on the last reminder once one went out, and takes the earliest due', () => {
    expect(outlook([row({ reminderCount: 1, lastReminderSent: '2026-09-12T08:00:00Z' }), row({ sentAt: '2026-09-11T09:00:00Z' })])).toEqual({
      kind: 'scheduled',
      at: '2026-09-14T09:00:00.000Z',
    })
  })

  it('stops at the cap, skips the answered and the revoked, and never schedules past the close or the expiry', () => {
    expect(outlook([row({ reminderCount: MAX_REMINDERS })])).toEqual({ kind: 'none' })
    expect(outlook([row({ completedAt: '2026-09-11T09:00:00Z' })])).toEqual({ kind: 'none' })
    expect(outlook([row({ status: 'revoked' })])).toEqual({ kind: 'none' })
    expect(outlook([row()], { endDate: '2026-09-12T00:00:00Z' })).toEqual({ kind: 'none' })
    expect(outlook([row({ expiresAt: '2026-09-12T00:00:00Z' })])).toEqual({ kind: 'none' })
  })

  it('says why none is scheduled: off, inactive, or nothing sent yet — and null while unread', () => {
    expect(outlook([row()], { sendReminders: false })).toEqual({ kind: 'off' })
    expect(outlook([row()], { status: 'scheduled' })).toEqual({ kind: 'inactive' })
    expect(outlook([row({ sentAt: null, status: 'pending' })])).toEqual({ kind: 'awaiting' })
    expect(outlook([])).toEqual({ kind: 'awaiting' })
    expect(outlook(null)).toBeNull()
  })

  it('floors the interval at one day and dates an overdue reminder today, not in the past', () => {
    expect(outlook([row()], { frequencyDays: 0 })).toEqual({ kind: 'scheduled', at: '2026-09-11T15:30:00.000Z' })
    expect(outlook([row({ sentAt: '2026-09-01T00:00:00Z' })])).toEqual({ kind: 'scheduled', at: now.toISOString() })
  })
})

describe('maskedLink', () => {
  it('prints the origin and the route and not one character of the token', () => {
    const masked = maskedLink('/s/Wit0Q1tKsuq5llHTSHvgd2TVImCK5zGZ55vYSigZW20', 'https://climate.timsint.com')
    expect(masked.startsWith('https://climate.timsint.com/s/')).toBe(true)
    for (const char of 'Wit0Q1tKsuq5') expect(masked.slice('https://climate.timsint.com/s/'.length)).not.toContain(char)
  })
})

describe('dimensionSections', () => {
  it('opens a section wherever the dimension changes and numbers the sections', () => {
    const sections = dimensionSections([
      { id: '1', category: 'trust' },
      { id: '2', category: 'trust' },
      { id: '3', category: 'workload' },
      { id: '4', category: null },
    ])
    expect(sections.map((s) => [s.category, s.index, s.count, s.questions.map((q) => q.position)])).toEqual([
      ['trust', 1, 3, [1, 2]],
      ['workload', 2, 3, [3]],
      [null, 3, 3, [4]],
    ])
  })
})
