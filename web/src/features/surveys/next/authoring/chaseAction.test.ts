import { describe, expect, it } from 'vitest'
import { chaseActionFor } from './chaseAction'

/**
 * The rule that decides which chase one person gets. It is worth pinning because for a month
 * the screen offered `reissue` to everybody and the API refused half of them with
 * `already_signed_in` -- a refusal the operator read as a bug rather than as the product
 * protecting somebody mid-survey.
 */
describe('chaseActionFor', () => {
  const key = { surveyUsername: 'esph-k7m2q9xa', credentialIssuedOn: '2026-10-20' }

  it('reminds somebody who has signed in and not finished', () => {
    expect(chaseActionFor({ ...key, status: 'started', lastSignInOn: '2026-10-21' }, 'per_survey')).toBe('remind')
  })

  it('reminds somebody who signed in and never answered anything', () => {
    // They have the key and it works -- they opened it and stopped. A new password would
    // replace one that is demonstrably in their hands.
    expect(chaseActionFor({ ...key, status: 'not_started', lastSignInOn: '2026-10-21' }, 'per_survey')).toBe('remind')
  })

  it('sends new credentials to somebody who holds a key and has never used it', () => {
    expect(chaseActionFor({ ...key, status: 'not_started', lastSignInOn: null }, 'per_survey')).toBe('reissue')
  })

  it('asks for an invitation when the person holds no key at all', () => {
    // The 15 people in ESPH's Clima audience who were never mailed. There is nothing to resend.
    expect(chaseActionFor(
      { surveyUsername: null, credentialIssuedOn: null, status: 'not_started', lastSignInOn: null },
      'per_survey',
    )).toBe('invite')
  })

  it('leaves somebody who finished alone', () => {
    expect(chaseActionFor({ ...key, status: 'completed', lastSignInOn: '2026-10-21' }, 'per_survey')).toBe('none')
  })

  it('chases `not_completed`, the state an anonymous survey reports', () => {
    // "Has not finished, and whether they started is not known" is not a reason to skip them.
    expect(chaseActionFor({ ...key, status: 'not_completed', lastSignInOn: '2026-10-21' }, 'per_survey')).toBe('remind')
    expect(chaseActionFor({ ...key, status: 'not_completed', lastSignInOn: null }, 'per_survey')).toBe('reissue')
  })

  it('offers nothing on a survey that does not hand out per-survey keys', () => {
    expect(chaseActionFor({ ...key, status: 'started', lastSignInOn: '2026-10-21' }, 'shared')).toBe('none')
    expect(chaseActionFor({ ...key, status: 'started', lastSignInOn: '2026-10-21' }, undefined)).toBe('none')
  })

  it('treats a key issued but with no username as still a key', () => {
    // The two fields are written together, but a payload from before 2026-10-22 may carry only
    // one. Reading either as "holds a key" is what stops that person being offered an invite
    // they do not need -- which would mint a SECOND key for somebody who already has one.
    expect(chaseActionFor(
      { surveyUsername: null, credentialIssuedOn: '2026-10-20', status: 'not_started', lastSignInOn: null },
      'per_survey',
    )).toBe('reissue')
  })
})
