import { describe, it, expect } from 'vitest'
import { audienceChange, audienceSelection, estimateAudience, targetsWholeCompany } from './audience'
import type { User } from '../../features/org-structure/api/users'

function user(id: string, departmentId: string | null, isActive = true): User {
  return {
    id,
    email: `${id}@acme.com`,
    name: id,
    role: 'employee',
    departmentId,
    isActive,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    username: null,
  }
}

const USERS = [
  user('a', 'eng'),
  user('b', 'eng'),
  user('c', 'sales'),
  user('d', null),
  user('e', 'eng', false),
]

describe('estimateAudience', () => {
  const NO_SELECTION = { departmentIds: [], userIds: [] }
  const NO_TARGETS = { departmentIds: [], userIds: [] }
  const targets = (departmentIds: string[], userIds: string[] = []) => ({ departmentIds, userIds })

  /**
   * The one that is both easy to get wrong and unrecoverable when it is.
   *
   * `allTargeted` with no targets of EITHER kind means the survey is company-wide, matching
   * `SurveyQueries.Audience`. Reading the empty lists as "nobody" would show an admin a
   * preview of 0 and then mail the entire company.
   */
  it('reads a survey with no targets of either kind as the whole company', () => {
    expect(estimateAudience('allTargeted', USERS, NO_SELECTION, NO_TARGETS)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reads allTargeted as the survey’s own department targets when it has some', () => {
    expect(estimateAudience('allTargeted', USERS, NO_SELECTION, targets(['eng']))).toEqual(['a', 'b'])
  })

  /**
   * THE DEFECT, measured in the ESPH rehearsal on 2026-10-17.
   *
   * The Teletrabajo survey targets people by name and no department at all. Zero DEPARTMENT
   * targets was read as "no targets whatsoever", so the estimate fell through to the whole
   * company: a one-person survey reported 4, and Monday's 240-person survey would have
   * reported 642 — on the reach, on "Respuestas x de N" and on the audience line — all week,
   * on the screen used to decide whether to chase people.
   */
  it('reads a survey targeted at PEOPLE as those people, not as the whole company', () => {
    expect(estimateAudience('allTargeted', USERS, NO_SELECTION, targets([], ['c']))).toEqual(['c'])
  })

  it('unions department targets with user targets, the way the server does', () => {
    // `SurveyQueries.Audience`: a person targeted directly is in the audience whatever their
    // department, so this reaches eng (a, b) plus c from sales.
    expect(estimateAudience('allTargeted', USERS, NO_SELECTION, targets(['eng'], ['c']))).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('counts a person who is both in a targeted department and targeted by name once', () => {
    expect(estimateAudience('allTargeted', USERS, NO_SELECTION, targets(['eng'], ['a']))).toEqual(['a', 'b'])
  })

  it('reaches a person targeted by name who has no department at all', () => {
    // The teletrabajadores case in miniature: a roster a department cannot express.
    expect(estimateAudience('allTargeted', USERS, NO_SELECTION, targets([], ['d']))).toEqual(['d'])
  })

  it('never counts an inactive person, even when the survey names them', () => {
    // The server's audience query is `IsActive`-filtered, so a named-but-deactivated person
    // would make the preview overcount against the mail that actually goes out.
    expect(estimateAudience('allTargeted', USERS, NO_SELECTION, targets([], ['e']))).toEqual([])
  })

  it('ignores the survey’s targets once departments are chosen explicitly', () => {
    expect(estimateAudience('departments', USERS, { departmentIds: ['sales'], userIds: [] }, targets(['eng']))).toEqual([
      'c',
    ])
  })

  it('ignores the survey’s user targets once people are chosen explicitly', () => {
    expect(estimateAudience('users', USERS, { departmentIds: [], userIds: ['a'] }, targets([], ['c']))).toEqual(['a'])
  })

  it('resolves an empty explicit department list to nobody, not to everybody', () => {
    // The opposite default from `allTargeted`, and deliberately so: the admin has said
    // "these departments" and named none. `audienceSelection` returns null for it, which
    // is what keeps the send button disabled rather than sending company-wide.
    expect(estimateAudience('departments', USERS, NO_SELECTION, targets(['eng']))).toEqual([])
    expect(audienceSelection('departments', [], [])).toBeNull()
  })

  it('excludes inactive users from every mode', () => {
    expect(estimateAudience('allTargeted', USERS, NO_SELECTION, targets(['eng']))).not.toContain('e')
    expect(estimateAudience('departments', USERS, { departmentIds: ['eng'], userIds: [] }, NO_TARGETS)).not.toContain('e')
    expect(estimateAudience('users', USERS, { departmentIds: [], userIds: ['e'] }, NO_TARGETS)).toEqual([])
  })

  it('puts a user with no department in no department, rather than in all of them', () => {
    expect(
      estimateAudience('departments', USERS, { departmentIds: ['eng', 'sales'], userIds: [] }, NO_TARGETS),
    ).not.toContain('d')
    // …but they are still in the company-wide audience.
    expect(estimateAudience('allTargeted', USERS, NO_SELECTION, NO_TARGETS)).toContain('d')
    // …and a survey targeting only departments does not reach them either.
    expect(estimateAudience('allTargeted', USERS, NO_SELECTION, targets(['eng', 'sales']))).not.toContain('d')
  })

  it('counts chosen people directly', () => {
    expect(estimateAudience('users', USERS, { departmentIds: [], userIds: ['a', 'c'] }, NO_TARGETS)).toEqual(['a', 'c'])
  })

  it('never counts an id the caller was not given', () => {
    // The users list is already scoped to the survey's company; an id from outside it
    // resolves to nobody rather than silently inflating the preview.
    expect(
      estimateAudience('users', USERS, { departmentIds: [], userIds: ['someone-elses-employee'] }, NO_TARGETS),
    ).toEqual([])
    // The same for a survey whose stored target is a person who is no longer in the directory.
    expect(estimateAudience('allTargeted', USERS, NO_SELECTION, targets([], ['someone-elses-employee']))).toEqual([])
  })
})

describe('targetsWholeCompany', () => {
  /**
   * The label's half of the same rule. Three screens printed "Toda la empresa" from
   * `departmentIds.length === 0` alone, which is true of every survey aimed at people
   * by name.
   */
  it('is true only when the survey targets neither departments nor people', () => {
    expect(targetsWholeCompany({ departmentIds: [], userIds: [] })).toBe(true)
    expect(targetsWholeCompany({ departmentIds: ['eng'], userIds: [] })).toBe(false)
    expect(targetsWholeCompany({ departmentIds: [], userIds: ['a'] })).toBe(false)
    expect(targetsWholeCompany({ departmentIds: ['eng'], userIds: ['a'] })).toBe(false)
  })
})

describe('audienceSelection', () => {
  it('produces exactly one selector, which is what the server demands', () => {
    expect(audienceSelection('allTargeted', ['eng'], ['a'])).toEqual({ allTargeted: true })
    expect(audienceSelection('departments', ['eng'], ['a'])).toEqual({ departmentIds: ['eng'] })
    expect(audienceSelection('users', ['eng'], ['a'])).toEqual({ userIds: ['a'] })
  })

  it('returns null when the chosen mode has no selection to send', () => {
    expect(audienceSelection('users', ['eng'], [])).toBeNull()
    expect(audienceSelection('departments', [], ['a'])).toBeNull()
  })

  it('copies the selection rather than aliasing the caller’s array', () => {
    const chosen = ['a']
    const selection = audienceSelection('users', [], chosen)
    chosen.push('b')
    expect(selection).toEqual({ userIds: ['a'] })
  })
})

describe('audienceChange', () => {
  const t = (departmentIds: string[], userIds: string[] = []) => ({ departmentIds, userIds })

  it('names who gains and who loses when the named people are swapped', () => {
    const change = audienceChange(USERS, t([], ['a', 'b']), t([], ['b', 'c']))
    expect(change.before).toEqual(['a', 'b'])
    expect(change.after).toEqual(['b', 'c'])
    expect(change.gained).toEqual(['c'])
    expect(change.lost).toEqual(['a'])
    expect(change.widensToCompany).toBe(false)
    expect(change.narrowsFromCompany).toBe(false)
  })

  it('unticking the last named person opens the survey to the whole company, not to nobody', () => {
    const change = audienceChange(USERS, t([], ['a']), t([], []))
    expect(change.after).toEqual(['a', 'b', 'c', 'd'])
    expect(change.gained).toEqual(['b', 'c', 'd'])
    expect(change.lost).toEqual([])
    expect(change.widensToCompany).toBe(true)
  })

  it('naming one person on a company-wide survey closes it to everybody else', () => {
    const change = audienceChange(USERS, t([]), t([], ['d']))
    expect(change.after).toEqual(['d'])
    expect(change.lost).toEqual(['a', 'b', 'c'])
    expect(change.narrowsFromCompany).toBe(true)
  })

  it('a person already reached through a department neither gains nor loses by being named', () => {
    const change = audienceChange(USERS, t(['eng']), t(['eng'], ['a', 'c']))
    expect(change.gained).toEqual(['c'])
    expect(change.lost).toEqual([])
  })

  it('never counts an inactive account on either side', () => {
    const change = audienceChange(USERS, t([], ['e']), t([], ['e', 'a']))
    expect(change.before).toEqual([])
    expect(change.gained).toEqual(['a'])
  })
})
