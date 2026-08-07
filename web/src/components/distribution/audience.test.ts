import { describe, it, expect } from 'vitest'
import { audienceSelection, estimateAudience } from './audience'
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
  /**
   * The one that is both easy to get wrong and unrecoverable when it is.
   *
   * `allTargeted` with no department targets means the survey is company-wide, matching
   * `ResolveAudienceAsync` and `SurveyQueries.AssignedTo`. Reading the empty list as
   * "nobody" would show an admin a preview of 0 and then mail the entire company.
   */
  it('reads a survey with no department targets as the whole company', () => {
    expect(estimateAudience('allTargeted', USERS, [], [], [])).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reads allTargeted as the survey’s own targets when it has some', () => {
    expect(estimateAudience('allTargeted', USERS, [], [], ['eng'])).toEqual(['a', 'b'])
  })

  it('ignores the survey’s targets once departments are chosen explicitly', () => {
    expect(estimateAudience('departments', USERS, ['sales'], [], ['eng'])).toEqual(['c'])
  })

  it('resolves an empty explicit department list to nobody, not to everybody', () => {
    // The opposite default from `allTargeted`, and deliberately so: the admin has said
    // "these departments" and named none. `audienceSelection` returns null for it, which
    // is what keeps the send button disabled rather than sending company-wide.
    expect(estimateAudience('departments', USERS, [], [], ['eng'])).toEqual([])
    expect(audienceSelection('departments', [], [])).toBeNull()
  })

  it('excludes inactive users from every mode', () => {
    expect(estimateAudience('allTargeted', USERS, [], [], ['eng'])).not.toContain('e')
    expect(estimateAudience('departments', USERS, ['eng'], [], [])).not.toContain('e')
    expect(estimateAudience('users', USERS, [], ['e'], [])).toEqual([])
  })

  it('puts a user with no department in no department, rather than in all of them', () => {
    expect(estimateAudience('departments', USERS, ['eng', 'sales'], [], [])).not.toContain('d')
    // …but they are still in the company-wide audience.
    expect(estimateAudience('allTargeted', USERS, [], [], [])).toContain('d')
  })

  it('counts chosen people directly', () => {
    expect(estimateAudience('users', USERS, [], ['a', 'c'], [])).toEqual(['a', 'c'])
  })

  it('never counts an id the caller was not given', () => {
    // The users list is already scoped to the survey's company; an id from outside it
    // resolves to nobody rather than silently inflating the preview.
    expect(estimateAudience('users', USERS, [], ['someone-elses-employee'], [])).toEqual([])
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
