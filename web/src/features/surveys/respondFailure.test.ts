import { describe, it, expect } from 'vitest'
import { SurveyRespondError } from './api/surveyResponses'
import {
  RESPOND_FAILURE_KINDS,
  SERVER_NOT_ACCEPTING,
  SERVER_PARTIAL_NOT_ALLOWED,
  SERVER_RESPONSE_LIMIT,
  respondFailureKey,
  respondFailureKind,
  type RespondFailureKind,
} from './respondFailure'
import { CATALOGUES } from '../../i18n/locale'
import { createTranslator } from '../../i18n/translate'

const es = createTranslator(CATALOGUES.es)
const en = createTranslator(CATALOGUES.en)

/** Audit 2026-10-22, R1: every refusal maps to our own sentence, by status first. */
describe('respondFailureKind', () => {
  const cases: readonly [status: number, message: string, publicEntry: boolean, kind: RespondFailureKind][] = [
    [400, SERVER_NOT_ACCEPTING, false, 'closed'],
    [400, SERVER_RESPONSE_LIMIT, false, 'responseLimit'],
    [400, SERVER_PARTIAL_NOT_ALLOWED, false, 'partialNotAllowed'],
    [400, 'sessionId is required when responding to an anonymous survey', false, 'rejected'],
    [400, '', false, 'rejected'],
    // A reworded or translated message is still a 400, and still never printed.
    [400, 'Esta encuesta no acepta respuestas', false, 'rejected'],
    [401, 'This survey is not currently available', false, 'signedOut'],
    [401, 'This survey is not currently available', true, 'unavailable'],
    [402, 'This survey is not currently accepting new responses', false, 'noSeats'],
    [403, '', false, 'notYours'],
    [404, 'Survey not found', false, 'notFound'],
    [409, 'conflict', false, 'conflict'],
    [422, 'invalid', false, 'rejected'],
    [429, 'Too many requests', false, 'tooMany'],
    [500, 'An unexpected error occurred', false, 'server'],
    [502, '', false, 'server'],
    [503, 'Service Unavailable', false, 'server'],
  ]

  it.each(cases)('%i “%s” (public: %s) is %s', (status, message, publicEntry, kind) => {
    expect(respondFailureKind(new SurveyRespondError(status, message), publicEntry)).toBe(kind)
  })

  it.each([new TypeError('Failed to fetch'), new TypeError('Load failed'), new Error('boom'), 'string', null])(
    'reads anything that is not an API status (%s) as no connection',
    (error) => {
      expect(respondFailureKind(error, false)).toBe('network')
    },
  )

  it('matches the three 400s on the server’s exact text and nothing looser', () => {
    // A substring or case-folded match would choose a sentence for a message the server did
    // not send. These must fall through to the generic 400.
    expect(respondFailureKind(new SurveyRespondError(400, `${SERVER_NOT_ACCEPTING}.`), false)).toBe('rejected')
    expect(respondFailureKind(new SurveyRespondError(400, SERVER_RESPONSE_LIMIT.toLowerCase()), false)).toBe('rejected')
  })

  it('holds the server texts the endpoint actually writes', () => {
    // A second copy of `SurveyResponseEndpoints.cs`'s strings, deliberately: when one of these
    // changes there, this table is the place the mapping silently degrades to `rejected`, and
    // the fallback is still a translated sentence — never the server's text.
    expect(SERVER_NOT_ACCEPTING).toBe('This survey is not currently accepting responses')
    expect(SERVER_RESPONSE_LIMIT).toBe('This survey has reached its response limit')
    expect(SERVER_PARTIAL_NOT_ALLOWED).toBe('This survey does not allow partial responses')
  })
})

describe('respondFailureKey', () => {
  it.each(RESPOND_FAILURE_KINDS)('%s has a sentence in both catalogues, Spanish in Spanish', (kind) => {
    const key = `surveyRespond.${respondFailureKey(kind)}`
    const spanish = es(key)
    const english = en(key)
    // `translate` answers the key itself for a missing entry.
    expect(spanish).not.toBe(key)
    expect(english).not.toBe(key)
    expect(spanish).not.toBe(english)
    // Never one of the server's own sentences.
    for (const server of [SERVER_NOT_ACCEPTING, SERVER_RESPONSE_LIMIT, SERVER_PARTIAL_NOT_ALLOWED]) {
      expect(spanish).not.toContain(server)
      expect(english).not.toContain(server)
    }
  })

  it('keeps the licensing refusal on the sentence it has always had', () => {
    expect(respondFailureKey('noSeats')).toBe('noSeatsBody')
  })

  it('says, for every refusal the server answered, that what was sent was not recorded', () => {
    const refused: RespondFailureKind[] = ['closed', 'responseLimit', 'rejected', 'signedOut', 'unavailable', 'notYours', 'notFound', 'conflict', 'tooMany']
    for (const kind of refused) expect(es(`surveyRespond.${respondFailureKey(kind)}`)).toMatch(/no se (registró|pudo registrar)/i)
    // Where nothing came back, the honest answer is that we could not confirm it either way.
    for (const kind of ['server', 'network'] as const) {
      expect(es(`surveyRespond.${respondFailureKey(kind)}`)).toContain('no pudimos confirmar')
    }
  })
})
