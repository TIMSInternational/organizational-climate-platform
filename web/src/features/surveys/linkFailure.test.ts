import { describe, it, expect } from 'vitest'
import { invitationFailureCopy, publicLinkFailureCopy, type LinkFailureCopy } from './linkFailure'
import { SurveyLinkError } from './api/surveyLinks'
import { CATALOGUES, LOCALES } from '../../i18n/locale'
import type { MessageNode } from '../../i18n/translate'

function error(status: number, reason: string | null = null, message = ''): SurveyLinkError {
  return new SurveyLinkError(status, message, reason)
}

/**
 * The four dead-link outcomes the API keeps distinct, and the one it deliberately does
 * not.
 *
 * The temptation on both of these routes is to catch the rejection and print one
 * apology, which typechecks, renders, and tells a respondent holding a revoked
 * invitation to keep reloading it. Each assertion below names the situation rather than
 * the status, because the status is not always what separates them: revoked and expired
 * are both 410 and differ only by `reason`.
 */
describe('invitationFailureCopy', () => {
  it('separates a revoked invitation from an expired one, which share a status', () => {
    const revoked = invitationFailureCopy(error(410, 'revoked'))
    const expired = invitationFailureCopy(error(410, 'expired'))

    expect(revoked.titleKey).toBe('invitationRevokedTitle')
    expect(expired.titleKey).toBe('invitationExpiredTitle')
    expect(revoked).not.toEqual(expired)
  })

  it('reports an unknown token as not found', () => {
    expect(invitationFailureCopy(error(404, 'not_found')).titleKey).toBe(
      'invitationNotFoundTitle',
    )
  })

  it('falls back to the status when the response carries no reason', () => {
    expect(invitationFailureCopy(error(404)).titleKey).toBe('invitationNotFoundTitle')
  })

  /**
   * Not a failure, and it must not wear a failure's clothes. A respondent told in an
   * amber warning box that they already answered will go looking for somebody to ask.
   */
  it('treats an already-answered invitation as a confirmation, not a warning', () => {
    const copy = invitationFailureCopy(error(409, 'already_completed'))

    expect(copy.titleKey).toBe('alreadyCompletedTitle')
    expect(copy.tone).toBe('success')
  })

  it('every other outcome is a warning', () => {
    for (const copy of [
      invitationFailureCopy(error(404, 'not_found')),
      invitationFailureCopy(error(410, 'revoked')),
      invitationFailureCopy(error(410, 'expired')),
      invitationFailureCopy(error(429)),
      invitationFailureCopy(null),
    ]) {
      expect(copy.tone).toBe('warning')
    }
  })

  /**
   * A reason this build has not heard of must not be matched to the nearest-looking
   * case. Falling through to the server's own message is the honest answer; guessing
   * "expired" for a 410 whose reason is something else is how revoked comes to be
   * reported as expired.
   */
  it('does not guess at a reason it does not recognise', () => {
    const copy = invitationFailureCopy(error(410, 'sabbatical'))

    expect(copy.titleKey).toBe('loadFailedTitle')
    expect(copy.bodyKey).toBeNull()
  })

  /** `Record` lookups are the classic way an attacker-supplied string finds `Object`. */
  it('is not confused by a reason borrowed from Object.prototype', () => {
    expect(invitationFailureCopy(error(410, 'constructor')).titleKey).toBe('loadFailedTitle')
    expect(invitationFailureCopy(error(410, '__proto__')).titleKey).toBe('loadFailedTitle')
  })

  it('handles a rejection that was not a SurveyLinkError at all', () => {
    // `fetch` rejects with a TypeError when the network is gone. The page has no status
    // to map, and the generic branch is the only honest answer.
    expect(invitationFailureCopy(null).titleKey).toBe('loadFailedTitle')
  })
})

describe('publicLinkFailureCopy', () => {
  /**
   * The client half of a deliberate server decision: `ResolvePublicLinkAsync` answers the
   * same 404 for an unknown token, a revoked link and a survey outside its window,
   * because a share link is held by anybody and "this existed but was revoked" confirms a
   * tenant's survey exists. The copy has to own that ambiguity rather than pick one.
   */
  it('gives one honest sentence for the whole 404, since the server gives one status', () => {
    const copy = publicLinkFailureCopy(error(404))

    expect(copy.titleKey).toBe('linkInvalidTitle')
    expect(copy.bodyKey).toBe('linkInvalidBody')
  })

  it('never claims the link was revoked or expired, which the server refuses to say', () => {
    const copy = publicLinkFailureCopy(error(404))

    expect(copy.titleKey).not.toBe('invitationRevokedTitle')
    expect(copy.titleKey).not.toBe('invitationExpiredTitle')
  })

  it('leaves any other status to the server message', () => {
    expect(publicLinkFailureCopy(error(429)).bodyKey).toBeNull()
    expect(publicLinkFailureCopy(null).bodyKey).toBeNull()
  })
})

/**
 * The assertion no rendering test makes.
 *
 * These keys are returned as strings and handed to a dynamic `t(key)`, which
 * `i18n/keysExist.test.ts` skips by design — it can only check literals. `translate()`
 * has no default value, so a typo here puts `invitationRevokedTitle` on screen in the
 * place of a sentence, in both languages, on the one page a respondent cannot ask an
 * administrator to work around.
 */
describe('every key these mappings can return', () => {
  const everyOutcome: LinkFailureCopy[] = [
    invitationFailureCopy(error(404, 'not_found')),
    invitationFailureCopy(error(410, 'revoked')),
    invitationFailureCopy(error(410, 'expired')),
    invitationFailureCopy(error(409, 'already_completed')),
    invitationFailureCopy(error(404)),
    invitationFailureCopy(error(500)),
    invitationFailureCopy(null),
    publicLinkFailureCopy(error(404)),
    publicLinkFailureCopy(error(500)),
    publicLinkFailureCopy(null),
  ]

  function resolves(locale: (typeof LOCALES)[number], key: string): boolean {
    let node: MessageNode | undefined = CATALOGUES[locale] as MessageNode
    for (const segment of `surveyRespond.${key}`.split('.')) {
      if (typeof node !== 'object' || node === null || !Object.hasOwn(node, segment)) return false
      node = node[segment]
    }
    return typeof node === 'string'
  }

  it.each(LOCALES)('exists in %s', (locale) => {
    const keys = everyOutcome.flatMap((copy) =>
      copy.bodyKey === null ? [copy.titleKey] : [copy.titleKey, copy.bodyKey],
    )

    // Guard the guard: an empty list would pass vacuously.
    expect(new Set(keys).size).toBeGreaterThan(6)
    expect(keys.filter((key) => !resolves(locale, key))).toEqual([])
  })
})
