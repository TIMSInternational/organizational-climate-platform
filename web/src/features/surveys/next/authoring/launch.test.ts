import { describe, expect, it } from 'vitest'
import {
  daysFrom,
  dimensionSections,
  invitationBuckets,
  launchChecklist,
  maskedLink,
  readySteps,
  remindersSent,
  responseRate,
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

  it('never meets the audience step on an audience it could not read', () => {
    expect(launchChecklist({ audience: null, publicLink: null, summary: null, reminders: null })[0].state).toBe('missing')
    expect(launchChecklist({ audience: 0, publicLink: null, summary: null, reminders: null })[0].state).toBe('missing')
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
