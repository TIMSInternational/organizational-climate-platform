import { describe, expect, it } from 'vitest'
import {
  canSend,
  daysFrom,
  dimensionSections,
  invitationCoverage,
  launchChecklist,
  maskedLink,
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

describe('invitationCoverage', () => {
  it('counts a per-survey invitee as covered only once they hold a key, against the whole audience', () => {
    // 617 in the audience, 300 invited so far, 290 of them with a key: the 327 never reached and
    // the 10 whose mail failed are both "sin código".
    expect(invitationCoverage({ summary: summary({ total: 300, pending: 300, withCode: 290 }), audience: 617, perSurvey: true })).toEqual({
      covered: 290,
      uncovered: 327,
      revoked: 0,
    })
  })

  it('counts a shared invitee as covered by the invitation record alone — nothing is ever mailed', () => {
    // Every row `pending` with a null sentAt, as every row has been since 2026-10-19: covered.
    expect(invitationCoverage({ summary: summary({ total: 6, pending: 5, revoked: 1 }), audience: 6, perSurvey: false })).toEqual({
      covered: 5,
      uncovered: 1,
      revoked: 1,
    })
  })

  it('falls back to the live invitations when the audience cannot be read', () => {
    expect(invitationCoverage({ summary: summary({ total: 41, pending: 41, withCode: 40 }), audience: null, perSurvey: true })).toEqual({
      covered: 40,
      uncovered: 1,
      revoked: 0,
    })
  })
})

describe('canSend', () => {
  it('is the server\'s RespondentVisible: scheduled and active, never a draft (409) or a closed survey', () => {
    expect(['draft', 'scheduled', 'active', 'closed', 'archived'].filter(canSend)).toEqual(['scheduled', 'active'])
  })
})

describe('launchChecklist', () => {
  it('reads the Meridiano Q4 state as 3 of 3: a working link is a door, so uninvited is not unready', () => {
    const steps = launchChecklist({ audience: 41, publicLink: '/s/abc', summary: summary(), perSurvey: false })
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ['audience', 'done'],
      ['link', 'done'],
      ['invitations', 'idle'],
    ])
    expect(readySteps(steps)).toBe(3)
  })

  it('calls a link-distributed survey with no roster at all ready — the whole point', () => {
    const steps = launchChecklist({ audience: 0, publicLink: '/s/abc', summary: summary(), perSurvey: false })
    expect(steps.map((step) => [step.id, step.state])).toEqual([
      ['audience', 'idle'],
      ['link', 'done'],
      ['invitations', 'idle'],
    ])
    expect(steps.some((step) => step.state === 'missing')).toBe(false)
  })

  it('still blocks when NEITHER door is open, because then nobody can answer', () => {
    const steps = launchChecklist({ audience: 0, publicLink: null, summary: summary(), perSurvey: false })
    expect(steps.find((step) => step.id === 'link')?.state).toBe('missing')
    expect(steps.find((step) => step.id === 'invitations')?.state).toBe('missing')
    expect(steps.find((step) => step.id === 'audience')?.state).toBe('missing')
  })

  it('completes a shared survey once everyone in the audience has an invitation, though none was ever "sent"', () => {
    // The state every shared survey has been in since the invitation email was deleted: every
    // row pending, sentAt null. It used to read `missing` for ever.
    const steps = launchChecklist({ audience: 41, publicLink: null, summary: summary({ total: 41, pending: 41 }), perSurvey: false })
    expect(steps.find((step) => step.id === 'invitations')?.state).toBe('done')
    expect(steps.find((step) => step.id === 'link')?.state).toBe('idle')
    expect(readySteps(steps)).toBe(3)
  })

  it('completes a per-survey survey only once everyone in the audience holds a key', () => {
    const state = (s: ReturnType<typeof summary>, audience: number | null = 617) =>
      launchChecklist({ audience, publicLink: null, summary: s, perSurvey: true })[2].state
    expect(state(summary({ total: 617, pending: 617, withCode: 617 }))).toBe('done')
    // Mid-send: 300 invited, all with keys, 317 not reached yet.
    expect(state(summary({ total: 300, pending: 300, withCode: 300 }))).toBe('missing')
    // Everyone invited, ten mails failed.
    expect(state(summary({ total: 617, pending: 617, withCode: 607 }))).toBe('missing')
    expect(state(summary())).toBe('missing')
    // A directory this viewer cannot read: the live invitations are the audience.
    expect(state(summary({ total: 41, pending: 41, withCode: 41 }), null)).toBe('done')
  })

  it('calls an audience it could not read unknown — never missing, never met — and an empty one missing', () => {
    const unread = launchChecklist({ audience: null, publicLink: null, summary: null, perSurvey: false })
    expect(unread[0].state).toBe('unknown')
    expect(readySteps(unread)).toBe(0)
    expect(launchChecklist({ audience: 0, publicLink: null, summary: null, perSurvey: false })[0].state).toBe('missing')
  })

  it('meets the audience step on invitations that exist, even when the directory is unread', () => {
    expect(launchChecklist({ audience: null, publicLink: null, summary: summary({ total: 41, pending: 41 }), perSurvey: false })[0].state).toBe('done')
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
