import { describe, it, expect } from 'vitest'
import { ACCEPT_FAILURE_KEYS, acceptInvitationFailure } from './derive'
import { CATALOGUES, LOCALES } from '../../../../i18n/locale'
import { createTranslator } from '../../../../i18n/translate'

/**
 * The five sentences `POST /invitations/{token}/accept` can end an invitation with, and the
 * rule that everything else leaves the form standing.
 *
 * Each literal below is quoted from `InvitationAcceptEndpoints.AcceptAsync`. They are
 * matched exactly and never rendered.
 */
describe('acceptInvitationFailure', () => {
  it('names the three refusals the artboard draws, and takes the form away for each', () => {
    expect(acceptInvitationFailure('Invitation has expired')).toMatchObject({
      kind: 'expired',
      terminal: true,
      titleKey: 'next.accept.expiredTitle',
    })
    expect(acceptInvitationFailure('Invitation has already been accepted')).toMatchObject({
      kind: 'used',
      terminal: true,
      titleKey: 'next.accept.usedTitle',
    })
    expect(acceptInvitationFailure('Invitation not found')).toMatchObject({
      kind: 'notFound',
      terminal: true,
      titleKey: 'next.accept.notFoundTitle',
    })
  })

  /**
   * A different case from `used`: the invitation may still be pending, but this address
   * already has an account and re-submitting cannot change that. Saying "esta invitación ya
   * se usó" here would be a lie.
   */
  it('keeps an existing account apart from an already-accepted invitation', () => {
    const existing = acceptInvitationFailure('A user with this email already exists')
    expect(existing.kind).toBe('accountExists')
    expect(existing.titleKey).not.toBe(acceptInvitationFailure('Invitation has already been accepted').titleKey)
  })

  it('reuses the deactivated-account sentences for the token the mint refused', () => {
    expect(acceptInvitationFailure('Account is not active')).toMatchObject({
      kind: 'inactive',
      terminal: true,
      titleKey: 'accountInactiveTitle',
      bodyKey: 'accountInactiveDetail',
    })
  })

  /**
   * The failure that would cost somebody their account: a refusal they could have fixed,
   * replaced by a dead end. `400` is the status of an expired invitation AND of a password
   * that misses the policy AND of an email on the wrong domain, so a status-keyed table
   * would strand the last two.
   */
  it('leaves the form standing for every refusal the invitee can still fix', () => {
    for (const message of [
      'Password must be at least 12 characters long, contain a special character',
      'Password is required',
      'Email domain does not match this company',
      'Email is required for a shareable-link invitation',
      'Invalid email format',
      'Name and password are required',
      'Request failed: 500',
      'Request failed: 429',
    ]) {
      const failure = acceptInvitationFailure(message)
      expect(failure.terminal, message).toBe(false)
      // Nothing to render: the caller shows the server's own words, which are the only
      // statement of which requirement was missed.
      expect(failure.titleKey, message).toBeNull()
      expect(failure.bodyKey, message).toBeNull()
    }
  })

  /** A reworded server message must degrade to the old screen, never to a wrong one. */
  it('does not recognise a near miss, so a reworded message keeps the form', () => {
    expect(acceptInvitationFailure('This invitation has expired').terminal).toBe(false)
    expect(acceptInvitationFailure('invitation has expired').terminal).toBe(false)
    expect(acceptInvitationFailure('').terminal).toBe(false)
  })

  /** The way out is only offered where signing in is genuinely the way out. */
  it('offers sign-in only for the two states an account already exists in', () => {
    expect(acceptInvitationFailure('Invitation has already been accepted').offerSignIn).toBe(true)
    expect(acceptInvitationFailure('A user with this email already exists').offerSignIn).toBe(true)
    expect(acceptInvitationFailure('Invitation has expired').offerSignIn).toBe(false)
    expect(acceptInvitationFailure('Invitation not found').offerSignIn).toBe(false)
  })

  /**
   * The assertion no rendering test makes: `createTranslator` returns the KEY on a miss, so
   * a typo would put `next.accept.expiredTitle` on screen where a sentence belongs.
   */
  it('returns only keys that exist in every catalogue', () => {
    expect(ACCEPT_FAILURE_KEYS.length).toBe(10)
    for (const locale of LOCALES) {
      const t = createTranslator(CATALOGUES[locale])
      for (const key of ACCEPT_FAILURE_KEYS) {
        expect(t(`auth.${key}`), `${locale}: ${key}`).not.toBe(`auth.${key}`)
      }
    }
  })
})
