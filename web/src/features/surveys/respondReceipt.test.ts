import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as receipt from './respondReceipt'
import { hasAnswered, markAnswered } from './respondReceipt'
import { clearSessionId, ensureSessionId, readSessionId } from './respondSession'

describe('respondReceipt', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('remembers nothing about a survey that has not been answered', () => {
    expect(hasAnswered('survey-1')).toBe(false)
  })

  it('remembers an answered survey', () => {
    markAnswered('survey-1')
    expect(hasAnswered('survey-1')).toBe(true)
  })

  /**
   * The flag is final, and the module offers nothing that clears it. An earlier version
   * exported `forgetAnswered` and every surface drew a "that was not me, answer again"
   * control; it was ruled against, because a visible way to answer twice is an invitation to.
   * Asserted on the module's own surface so the control cannot come back by the side door.
   */
  it('offers no way to clear the flag', () => {
    markAnswered('survey-1')
    const api = Object.keys(receipt).sort()
    expect(api).toEqual(['hasAnswered', 'markAnswered'])
    expect(hasAnswered('survey-1')).toBe(true)
  })

  /**
   * Scoped per survey for the same reason the session id is: a respondent who answers one
   * anonymous survey is still owed every other one. A global flag would silence a whole
   * list the first time somebody answered anything.
   */
  it('keeps a separate flag per survey', () => {
    markAnswered('survey-1')

    expect(hasAnswered('survey-1')).toBe(true)
    expect(hasAnswered('survey-2')).toBe(false)
  })

  /**
   * The flag carries ONE bit and must never grow a second. No timestamp, because the
   * product never shows when anybody answered and a local answer log with times is what a
   * shared or examined device would give up; no answers, because dropping those is the
   * whole job of `clearSessionId`. Asserted on the stored value itself rather than through
   * the API, since the API cannot tell the difference and a future convenience field would
   * sail past every other test in this file.
   */
  it('stores one bit and nothing that could identify or date the respondent', () => {
    markAnswered('survey-1')

    const keys = Object.keys(window.localStorage)
    expect(keys).toEqual(['surveyAnswered:survey-1'])
    expect(window.localStorage.getItem('surveyAnswered:survey-1')).toBe('1')
  })

  /**
   * The two halves of completion, together, because they are easy to conflate and the
   * product depends on their difference: the resume credential dies so a shared browser
   * cannot read the answers back, and the flag survives so the survey stops being offered.
   */
  it('survives clearing the session id, which is what makes the pair work', () => {
    ensureSessionId('survey-1')
    clearSessionId('survey-1')
    markAnswered('survey-1')

    expect(readSessionId('survey-1')).toBeNull()
    expect(hasAnswered('survey-1')).toBe(true)
  })

  /**
   * `localStorage` throws outright in some privacy modes. The degradation has to be
   * "offer the survey", never "withhold it": a reader who cannot be remembered may
   * genuinely still owe an answer, and refusing them the form would be the worse error.
   *
   * ## The mock is asserted before the behaviour is
   *
   * Spied on **`window.localStorage` itself**, not on `Storage.prototype`, and the first
   * three assertions are about the mock rather than about the module.
   *
   * The prototype is the wrong target here because of `src/test/setup.ts`: Node 25 ships
   * its own inert Web Storage on `globalThis`, so the setup installs a happy-dom `Storage`
   * **instance** over it per test file. `window.localStorage` is therefore an object whose
   * methods a `Storage.prototype` spy does not reliably reach — measured in this file,
   * where that spy stops biting the moment an earlier test has written a key.
   *
   * The instrument is asserted first because the neighbouring `respondSession.test.ts`
   * shows what happens otherwise: it blocks storage via `Storage.prototype` and then
   * asserts `readSessionId` is null, `ensureSessionId` is truthy and `clearSessionId` does
   * not throw — every one of which holds just as well when storage is working and nothing
   * has been stored. That test passes whether or not its mock bites, so it is three green
   * assertions about nothing. These three lines are what stop this one going the same way.
   */
  it('reports nothing remembered, and never throws, when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(blocked)
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(blocked)

    // The instrument, before anything that depends on it.
    expect(() => window.localStorage.getItem('x')).toThrow('blocked')
    expect(() => window.localStorage.setItem('x', '1')).toThrow('blocked')

    expect(() => markAnswered('survey-1')).not.toThrow()
    expect(hasAnswered('survey-1')).toBe(false)
  })
})
