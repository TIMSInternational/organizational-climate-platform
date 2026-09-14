import { describe, it, expect } from 'vitest'
import {
  entryPace,
  entryState,
  outcomeLook,
  respondFailureOutcome,
  type EntryOutcome,
  type LinkLoad,
  type ViewLoad,
} from './derive'
import { SurveyLinkError, type SurveyPublicLinkDetail } from '../../api/surveyLinks'
import { SurveyRespondError, type SurveyRespondView } from '../../api/surveyResponses'
import { CATALOGUES, LOCALES } from '../../../../i18n/locale'
import type { MessageNode } from '../../../../i18n/translate'

const DETAIL: SurveyPublicLinkDetail = {
  surveyId: 'survey-77',
  surveyTitle: 'Encuesta de Clima Q4',
  surveyDescription: 'Una descripción del autor',
  language: 'es',
  resolvedLocale: 'es',
  fallbackFields: [],
  surveyStartDate: '2026-09-01T00:00:00Z',
  surveyEndDate: '2026-10-10T00:00:00Z',
  requireLogin: false,
  allowAnonymous: true,
  singleResponse: true,
}

function view(overrides: Partial<SurveyRespondView> = {}): SurveyRespondView {
  return {
    id: 'survey-77',
    title: 'Encuesta de Clima Q4',
    description: null,
    type: 'general_climate',
    language: 'es',
    resolvedLocale: 'es',
    fallbackFields: [],
    startDate: '2026-09-01T00:00:00Z',
    endDate: '2026-10-10T00:00:00Z',
    anonymous: true,
    allowPartialResponses: false,
    autoSave: false,
    randomizeQuestions: false,
    showProgress: true,
    timeLimitMinutes: null,
    questions: [],
    inProgress: null,
    ...overrides,
  }
}

const RESOLVED: LinkLoad = { status: 'resolved', detail: DETAIL }
const READY: ViewLoad = { status: 'ready', view: view() }

describe('entryState', () => {
  it('waits while the token is being resolved, with nothing about a survey on screen', () => {
    expect(entryState({ status: 'resolving' }, { status: 'idle' }, false, false)).toEqual({
      status: 'waiting',
    })
  })

  /**
   * The rule this page exists to keep. A share link is held by anybody at all, and a
   * token that did not resolve has told this client nothing it is entitled to render —
   * no title, no close date, no question count, no anonymity.
   *
   * The assertion is deliberately hostile: a `ready` view is handed in **alongside** the
   * dead link, which is the shape a future refactor produces the moment somebody keeps
   * the last successful load around. The dead link still wins.
   */
  it('answers a dead link before it ever looks at a survey', () => {
    const dead: LinkLoad = { status: 'dead', error: new SurveyLinkError(404, 'nope', null) }

    const state = entryState(dead, READY, false, false)

    expect(state.status).toBe('blocked')
    expect(state.status === 'blocked' && state.outcome.titleKey).toBe('linkInvalidTitle')
    expect(JSON.stringify(state)).not.toContain('Encuesta de Clima Q4')
  })

  /**
   * Even with the respondent already answering. `answering` is a flag this page sets on
   * a button press, and a token that has since gone dead must not leave them in a form
   * addressed to a survey the server will no longer serve.
   */
  it('a dead link outranks the respondent having begun', () => {
    const dead: LinkLoad = { status: 'dead', error: null }

    expect(entryState(dead, READY, true, false).status).toBe('blocked')
  })

  it('hands over to the form once the respondent presses the button', () => {
    expect(entryState(RESOLVED, READY, true, false)).toEqual({
      status: 'answering',
      surveyId: 'survey-77',
    })
  })

  it('waits again while the survey itself is being read', () => {
    expect(entryState(RESOLVED, { status: 'loading' }, false, false).status).toBe('waiting')
    expect(entryState(RESOLVED, { status: 'idle' }, false, false).status).toBe('waiting')
  })

  it('draws the entry card once both loads have landed', () => {
    const state = entryState(RESOLVED, READY, false, false)

    expect(state.status).toBe('landing')
    expect(state.status === 'landing' && state.view.anonymous).toBe(true)
  })

  /**
   * The respondent's answers are already in. Offering "Empezar" here sends them into a
   * form whose very next screen tells them there is nothing to do — and a closed survey
   * reported as a fresh one is how somebody comes to believe their answers were lost.
   */
  it('reports an already-complete response instead of offering to start', () => {
    const complete = view({
      inProgress: {
        responseId: 'r1',
        sessionId: 's1',
        isComplete: true,
        language: 'es',
        startTime: '2026-09-02T00:00:00Z',
        completionTime: '2026-09-02T00:10:00Z',
        answers: [],
      },
    })

    const state = entryState(RESOLVED, { status: 'ready', view: complete }, false, false)

    expect(state.status).toBe('blocked')
    expect(state.status === 'blocked' && state.outcome.titleKey).toBe('alreadyCompletedTitle')
    // It is a confirmation, not a failure, and must not be dressed as one.
    expect(state.status === 'blocked' && state.outcome.tone).toBe('success')
  })

  /** An in-progress response is not a finished one: that respondent is resuming. */
  it('still offers to start when a response is in progress but unfinished', () => {
    const partial = view({
      inProgress: {
        responseId: 'r1',
        sessionId: 's1',
        isComplete: false,
        language: 'es',
        startTime: '2026-09-02T00:00:00Z',
        completionTime: null,
        answers: [],
      },
    })

    expect(entryState(RESOLVED, { status: 'ready', view: partial }, false, false).status).toBe(
      'landing',
    )
  })

  it('maps a failed survey read through the respond rules', () => {
    const failed: ViewLoad = {
      status: 'failed',
      error: new SurveyRespondError(400, 'This survey is not currently accepting responses'),
    }

    const state = entryState(RESOLVED, failed, false, false)

    expect(state.status).toBe('blocked')
    expect(state.status === 'blocked' && state.outcome.titleKey).toBe('closedTitle')
  })
})

describe('respondFailureOutcome', () => {
  /**
   * A closed survey and a broken link are two different sentences with two different
   * next steps, and the temptation is to give the share link's one sentence to both —
   * it is already on the page for the 404. A respondent told their live link is broken
   * goes hunting for a new one that does not exist.
   */
  it('separates a closed survey from a link that does not open', () => {
    const closed = respondFailureOutcome(400, false)

    expect(closed.titleKey).toBe('closedTitle')
    expect(closed.titleKey).not.toBe('linkInvalidTitle')
    expect(closed.signIn).toBe(false)
  })

  /**
   * The one inference this page is entitled to make, and why.
   *
   * `ResolveRespondentAsync` refuses an unauthenticated caller when the survey is not
   * anonymous OR is not accepting responses, and deliberately does not say which. Here
   * the second half is already ruled out — `ResolvePublicLinkAsync` answered 404 unless
   * `SurveyStatuses.AcceptsResponses`, and it answered moments ago — so the remaining
   * cause is that the survey records who answers, and signing in is the one act that
   * helps.
   */
  it('tells a visitor with no session that the survey records who answers', () => {
    const outcome = respondFailureOutcome(401, false)

    expect(outcome.titleKey).toBe('next.entrySignInTitle')
    expect(outcome.signIn).toBe(true)
  })

  /**
   * With a bearer in hand the ambiguity is back: the server saw a credential and did
   * not accept it, which is as likely to be a stale session as a named survey. The
   * honest copy stays, and the sign-in is still offered because it is still the only
   * thing that might help.
   */
  it('keeps the ambiguous sentence when a token was sent and refused', () => {
    const outcome = respondFailureOutcome(401, true)

    expect(outcome.titleKey).toBe('unavailableTitle')
    expect(outcome.titleKey).not.toBe('next.entrySignInTitle')
    expect(outcome.signIn).toBe(true)
  })

  it('does not offer a sign-in for a survey that is not this person to answer', () => {
    const outcome = respondFailureOutcome(403, true)

    expect(outcome.titleKey).toBe('notYoursTitle')
    expect(outcome.signIn).toBe(false)
  })

  it('reports a missing survey as missing', () => {
    expect(respondFailureOutcome(404, false).titleKey).toBe('notFoundTitle')
  })

  /**
   * A status this client has no sentence for falls back to the server's own message —
   * `bodyKey: null` is what tells the card to print it. Guessing at the nearest-looking
   * case is what makes a 429 read as a closed survey.
   */
  it('falls back to the server message for a status it has no sentence for', () => {
    for (const status of [429, 500, null]) {
      const outcome = respondFailureOutcome(status, false)
      expect(outcome.titleKey).toBe('loadFailedTitle')
      expect(outcome.bodyKey).toBeNull()
    }
  })

  /** No failure branch may wear the success treatment. */
  it('never dresses a failure as a confirmation', () => {
    for (const status of [400, 401, 403, 404, 429, null]) {
      expect(respondFailureOutcome(status, false).tone).toBe('warning')
      expect(respondFailureOutcome(status, true).tone).toBe('warning')
    }
  })
})

describe('outcomeLook', () => {
  /** The seven cards PublicRespondEntryStates draws, glyph and tile as it tints them. */
  it.each([
    ['closedTitle', 'calendar', 'neutral'],
    ['linkInvalidTitle', 'link', 'warning'],
    ['invitationExpiredTitle', 'clock', 'warning'],
    ['invitationRevokedTitle', 'alert', 'warning'],
    ['invitationNotFoundTitle', 'search', 'neutral'],
    ['alreadyCompletedTitle', 'check', 'good'],
    ['next.entrySignInTitle', 'lock', 'neutral'],
  ])('draws %s as %s on the %s tile', (key, glyph, tile) => {
    expect(outcomeLook(key, key === 'alreadyCompletedTitle' ? 'success' : 'warning')).toEqual({
      glyph,
      tile,
    })
  })

  it('falls back to the warning treatment for an outcome it has never heard of', () => {
    expect(outcomeLook('somethingNew', 'warning')).toEqual({ glyph: 'alert', tile: 'warning' })
    expect(outcomeLook('somethingNew', 'success')).toEqual({ glyph: 'alert', tile: 'good' })
  })

  /** A `Record` lookup is the classic way a borrowed string finds `Object`. */
  it('is not confused by a key borrowed from Object.prototype', () => {
    expect(outcomeLook('constructor', 'warning').glyph).toBe('alert')
    expect(outcomeLook('__proto__', 'warning').glyph).toBe('alert')
  })
})

describe('entryPace', () => {
  /**
   * The canvas's own numbers: Grupo Meridiano's six-question Q4 is "unos 4 minutos"
   * (RespondSurveyPhone and EmployeeDashboard, 10 Sep), which is `estimatedMinutes`'s
   * two-thirds of a minute a question.
   */
  it('quotes the one estimate this product has, not a second one', () => {
    expect(entryPace(6)).toEqual({ key: 'next.entryPace', params: { count: 6, minutes: 4 } })
  })

  /**
   * `interpolate` is a straight `{name}` substitution with no plural machinery, so one
   * key would print "1 preguntas" and "unos 1 minutos" — on the first screen of the
   * product most respondents ever see.
   */
  it('does not print a plural for a single question', () => {
    expect(entryPace(1).key).toBe('next.entryPaceOne')
  })

  it('says under a minute rather than "about 1 minute"', () => {
    // estimatedMinutes(2) === 1, which isUnderAMinute reads as under a minute.
    expect(entryPace(2).key).toBe('next.entryPaceBrief')
    expect(entryPace(3).key).toBe('next.entryPace')
  })
})

/**
 * The assertion no rendering test makes.
 *
 * These keys are handed to a dynamic `t(key)`, which `i18n/keysExist.test.ts` skips by
 * design — it can only check literals. `translate()` has no default, so a typo here
 * puts `entrySignInTitle` on screen in the place of a sentence, in both languages, on
 * the one page a respondent cannot ask an administrator to work around.
 */
describe('every key these rules can return', () => {
  const outcomes: EntryOutcome[] = [
    respondFailureOutcome(400, false),
    respondFailureOutcome(401, false),
    respondFailureOutcome(401, true),
    respondFailureOutcome(403, false),
    respondFailureOutcome(404, false),
    respondFailureOutcome(500, false),
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
    const keys = [
      ...outcomes.flatMap((outcome) =>
        outcome.bodyKey === null ? [outcome.titleKey] : [outcome.titleKey, outcome.bodyKey],
      ),
      'alreadyCompletedTitle',
      'alreadyCompletedBody',
      ...[1, 2, 6].map((count) => entryPace(count).key),
      'next.entryStart',
      'next.entryAfter',
      'next.entryArrivedByLink',
      'next.entryNoAccount',
    ]

    // Guard the guard: an empty list would pass vacuously.
    expect(new Set(keys).size).toBeGreaterThan(12)
    expect(keys.filter((key) => !resolves(locale, key))).toEqual([])
  })
})
