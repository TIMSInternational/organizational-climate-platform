import { describe, it, expect } from 'vitest'
import { microclimateInvitationFailureCopy } from './microclimateLinkFailure'
import { MicroclimateLinkError } from './api/microclimateLinks'
import { CATALOGUES, LOCALES } from '../../i18n/locale'
import { createTranslator } from '../../i18n/translate'

/**
 * The mapping from a dead link to a sentence, and the assertion no rendering test makes:
 * that every key it can return exists in **both** catalogues.
 *
 * `translate()` has no default value, so a typo here would put `invitationExpiredTitle` on
 * screen where a sentence belongs — and a page test that only exercises the happy path, or
 * only exercises English, would never see it.
 */

function fail(status: number, reason: string | null): MicroclimateLinkError {
  return new MicroclimateLinkError(status, 'from the server', reason)
}

describe('microclimateInvitationFailureCopy', () => {
  /**
   * Reason first, status second. The status alone cannot separate revoked from expired:
   * `LoadByTokenAsync` answers 410 for both and distinguishes them only by `reason` — and
   * it checks revoked BEFORE expiry precisely so an admin's deliberate act is not reported
   * as the passage of time. Collapsing them here would throw that away.
   */
  it('tells revoked and expired apart, which the 410 alone cannot', () => {
    expect(microclimateInvitationFailureCopy(fail(410, 'revoked')).titleKey).toBe(
      'invitationRevokedTitle',
    )
    expect(microclimateInvitationFailureCopy(fail(410, 'expired')).titleKey).toBe(
      'invitationExpiredTitle',
    )
  })

  /**
   * Not an error the respondent should be made to feel bad about. A person whose answers
   * are already in, told in an amber box with a warning glyph, will assume something went
   * wrong and go looking for somebody to ask.
   */
  it('reads an already-answered pulse as a success and not a failure', () => {
    const copy = microclimateInvitationFailureCopy(fail(409, 'already_completed'))
    expect(copy.tone).toBe('success')
    expect(copy.titleKey).toBe('invitationAlreadyCompletedTitle')
  })

  it('maps a not-found reason and a bare 404 to the same copy', () => {
    expect(microclimateInvitationFailureCopy(fail(404, 'not_found')).titleKey).toBe(
      'invitationNotFoundTitle',
    )
    expect(microclimateInvitationFailureCopy(fail(404, null)).titleKey).toBe(
      'invitationNotFoundTitle',
    )
  })

  /**
   * A reason this build has not heard of must NOT match the nearest-looking case. The
   * client guessing at a vocabulary it does not recognise is exactly how "revoked" comes to
   * be reported as "expired", and the server's own message is a better answer than the
   * nearest sentence we happen to have.
   */
  it('falls through to the generic branch rather than guessing at an unknown reason', () => {
    const copy = microclimateInvitationFailureCopy(fail(410, 'quarantined_by_the_moon'))
    expect(copy.titleKey).toBe('invitationLoadFailedTitle')
    expect(copy.bodyKey).toBeNull()
    expect(copy.tone).toBe('warning')
  })

  /** A 429 from the token rate limiter, a 5xx, and an offline `TypeError` out of `fetch`. */
  it.each([
    ['a rate-limited request', fail(429, null)],
    ['a server error', fail(500, null)],
    ['a rejection that was not a link error at all', null],
  ])('shows the generic outcome for %s', (_what, error) => {
    expect(microclimateInvitationFailureCopy(error).titleKey).toBe('invitationLoadFailedTitle')
    expect(microclimateInvitationFailureCopy(error).bodyKey).toBeNull()
  })

  /**
   * The guard the page cannot give: every key this function can return resolves in BOTH
   * catalogues, under the `microclimates` namespace the page reads them with.
   *
   * Through the real `createTranslator`, not by indexing the JSON: `translate()` returns
   * the KEY itself on a miss, so "the key exists" and "the page renders a sentence" are the
   * same question only when it is asked the way the page asks it.
   */
  describe.each(LOCALES)('every key it can return resolves in %s', (locale) => {
    const t = createTranslator(CATALOGUES[locale])

    const OUTCOMES: [string, MicroclimateLinkError | null][] = [
      ['not_found', fail(404, 'not_found')],
      ['revoked', fail(410, 'revoked')],
      ['expired', fail(410, 'expired')],
      ['already_completed', fail(409, 'already_completed')],
      ['an unrecognised reason', fail(410, 'unrecognised')],
      ['no error object at all', null],
    ]

    it.each(OUTCOMES)('for %s', (_what, error) => {
      const copy = microclimateInvitationFailureCopy(error)

      const titleKey = `microclimates.${copy.titleKey}`
      expect(t(titleKey), `${titleKey} is missing from ${locale}.json`).not.toBe(titleKey)

      if (copy.bodyKey !== null) {
        const bodyKey = `microclimates.${copy.bodyKey}`
        expect(t(bodyKey), `${bodyKey} is missing from ${locale}.json`).not.toBe(bodyKey)
      }
    })
  })
})
