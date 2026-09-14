import { describe, it, expect } from 'vitest'
import {
  DEAD_COPY_KEYS,
  deadCopy,
  deadKind,
  invitationView,
  respondUntil,
  type ResolveState,
} from './derive'
import { MicroclimateLinkError, type MicroclimateInvitationTokenDetail } from '../../api/microclimateLinks'
import { CATALOGUES, LOCALES } from '../../../../i18n/locale'
import { createTranslator } from '../../../../i18n/translate'

function detail(
  overrides: Partial<MicroclimateInvitationTokenDetail> = {},
): MicroclimateInvitationTokenDetail {
  return {
    invitationId: 'inv-1',
    microclimateId: 'micro-42',
    microclimateTitle: 'Pulso semanal',
    microclimateDescription: 'Cómo fue la semana',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    status: 'sent',
    microclimateStatus: 'active',
    startTime: '2026-09-09T09:00:00Z',
    endTime: '2026-09-11T17:00:00Z',
    expiresAt: '2026-09-12T17:00:00Z',
    anonymity: {
      anonymous: true,
      highestRecordableState: 'opened',
      suppressedStates: ['started', 'completed'],
      guarantee: 'Tracking stops at opened.',
    },
    ...overrides,
  }
}

function resolved(overrides: Partial<MicroclimateInvitationTokenDetail> = {}): ResolveState {
  return { status: 'resolved', detail: detail(overrides) }
}

function dead(status: number, reason: string | null, message = 'from the server'): ResolveState {
  return { status: 'dead', error: new MicroclimateLinkError(status, message, reason) }
}

describe('deadKind', () => {
  /**
   * The status alone cannot separate revoked from expired: `LoadByTokenAsync` answers 410
   * for both and distinguishes them only by `reason` — and it checks revoked BEFORE expiry
   * precisely so an admin's deliberate act is not reported as the passage of time.
   */
  it('tells revoked and expired apart, which the shared 410 cannot', () => {
    expect(deadKind(new MicroclimateLinkError(410, '', 'revoked'))).toBe('revoked')
    expect(deadKind(new MicroclimateLinkError(410, '', 'expired'))).toBe('expired')
  })

  it('maps a not_found reason and a bare 404 to the same card', () => {
    expect(deadKind(new MicroclimateLinkError(404, '', 'not_found'))).toBe('notFound')
    expect(deadKind(new MicroclimateLinkError(404, '', null))).toBe('notFound')
  })

  it('reads an already-answered pulse as its own card, not as a failure', () => {
    expect(deadKind(new MicroclimateLinkError(409, '', 'already_completed'))).toBe('used')
  })

  /**
   * A reason this build has not heard of must NOT match the nearest-looking case: a client
   * guessing at a vocabulary it does not recognise is how "revoked" comes to be reported as
   * "expired".
   */
  it('falls through to unknown for a reason and a status it does not recognise', () => {
    expect(deadKind(new MicroclimateLinkError(410, '', 'consumed_by_gremlins'))).toBe('unknown')
    expect(deadKind(new MicroclimateLinkError(429, '', null))).toBe('unknown')
    expect(deadKind(null)).toBe('unknown')
  })
})

describe('invitationView', () => {
  it('draws the landing card for a live anonymous pulse', () => {
    const view = invitationView(resolved(), false)
    expect(view.kind).toBe('landing')
  })

  /**
   * The fail-closed rule. A refused token is settled from the ERROR alone — nothing about
   * the session is read, so a title, a description or a date cannot reach a page opened
   * with somebody else's link.
   */
  it('settles a refused token without reading anything about the session', () => {
    const view = invitationView(dead(410, 'revoked'), true)
    expect(view).toEqual({ kind: 'dead', dead: 'revoked', serverMessage: 'from the server' })
    expect(JSON.stringify(view)).not.toContain('Pulso semanal')
  })

  it('carries no server message when the refusal had none', () => {
    expect(invitationView(dead(404, 'not_found', ''), false)).toEqual({
      kind: 'dead',
      dead: 'notFound',
      serverMessage: null,
    })
  })

  /**
   * A token can outlive its session's close: an invitation minted at 09:00 for a pulse
   * that ended at 09:30 still resolves at 09:29 and is useless at 09:31.
   */
  it('draws the closed card for a session that is no longer active', () => {
    expect(invitationView(resolved({ microclimateStatus: 'closed' }), true)).toEqual({
      kind: 'closed',
      closesAt: '2026-09-11T17:00:00Z',
    })
    expect(invitationView(resolved({ microclimateStatus: 'draft' }), true).kind).toBe('closed')
  })

  /**
   * Closed BEFORE signIn. Telling somebody to go and fetch their password for a session
   * that ended on Tuesday is a worse sentence than the one that says it ended.
   */
  it('prefers the closed card over the sign-in card when both would apply', () => {
    const state = resolved({
      microclimateStatus: 'closed',
      anonymity: { ...detail().anonymity, anonymous: false },
    })
    expect(invitationView(state, false).kind).toBe('closed')
  })

  it('asks an identified pulse’s visitor to sign in only when no session is stored', () => {
    const identified = { ...detail().anonymity, anonymous: false }
    expect(invitationView(resolved({ anonymity: identified }), false).kind).toBe('signIn')
    expect(invitationView(resolved({ anonymity: identified }), true).kind).toBe('landing')
  })

  /** An anonymous pulse takes an unauthenticated respondent by design. */
  it('never asks an anonymous pulse’s visitor to sign in', () => {
    expect(invitationView(resolved(), false).kind).toBe('landing')
  })

  it('draws nothing while the token is still being resolved', () => {
    expect(invitationView({ status: 'loading' }, false)).toEqual({ kind: 'loading' })
  })
})

describe('respondUntil', () => {
  /**
   * `endTime` is when the session stops accepting answers and `expiresAt` is when this
   * person's token stops working, and they are different numbers. Printing the later one
   * gives whichever respondent the other applied to a deadline that is wrong in the
   * direction that costs them their answer.
   */
  it('is the earlier of the session’s close and the token’s expiry, whichever it is', () => {
    expect(respondUntil('2026-09-11T17:00:00Z', '2026-09-12T17:00:00Z')).toBe('2026-09-11T17:00:00Z')
    expect(respondUntil('2026-09-12T17:00:00Z', '2026-09-11T17:00:00Z')).toBe('2026-09-11T17:00:00Z')
  })

  /**
   * An unparseable date must not be read as epoch 0, which would win every comparison and
   * print 1970 as the deadline.
   */
  it('ignores a date that will not parse rather than letting it win', () => {
    expect(respondUntil('not a date', '2026-09-12T17:00:00Z')).toBe('2026-09-12T17:00:00Z')
    expect(respondUntil('2026-09-11T17:00:00Z', '')).toBe('2026-09-11T17:00:00Z')
  })

  it('answers null when neither date can be read, so the card prints no reading', () => {
    expect(respondUntil('not a date', '')).toBeNull()
  })
})

describe('deadCopy', () => {
  it('leaves only the unknown branch to the server’s own words', () => {
    expect(deadCopy('unknown').bodyKey).toBeNull()
    for (const kind of ['notFound', 'revoked', 'expired', 'used'] as const) {
      expect(deadCopy(kind).bodyKey, kind).not.toBeNull()
    }
  })

  /**
   * The assertion no rendering test makes: `createTranslator` returns the KEY on a miss, so
   * a typo here would put `next.invitation.expiredTitle` on screen in the place of a
   * sentence, in whichever language the page test did not exercise.
   */
  it('returns only keys that exist in every catalogue', () => {
    expect(DEAD_COPY_KEYS.length).toBeGreaterThan(0)
    for (const locale of LOCALES) {
      const t = createTranslator(CATALOGUES[locale])
      for (const key of DEAD_COPY_KEYS) {
        expect(t(`microclimates.${key}`), `${locale}: ${key}`).not.toBe(`microclimates.${key}`)
      }
    }
  })

  /** The three keys the closed branch reaches for are not in the table, so assert them too. */
  it('has a catalogue sentence for the closed pulse, dated and undated', () => {
    for (const locale of LOCALES) {
      const t = createTranslator(CATALOGUES[locale])
      for (const key of [
        'microclimates.next.invitation.closedLabel',
        'microclimates.next.invitation.closedTitle',
        'microclimates.next.invitation.closedBody',
        'microclimates.next.invitation.closedBodyUndated',
      ]) {
        expect(t(key), `${locale}: ${key}`).not.toBe(key)
      }
      expect(t('microclimates.next.invitation.closedBody', { date: '11 de septiembre' })).toContain(
        '11 de septiembre',
      )
    }
  })
})
