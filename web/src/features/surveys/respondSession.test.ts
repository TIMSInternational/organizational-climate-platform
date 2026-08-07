import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearSessionId, ensureSessionId, readSessionId } from './respondSession'

describe('respondSession', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('mints an id once and returns the same one afterwards', () => {
    const first = ensureSessionId('survey-1')
    expect(first).toBeTruthy()
    expect(ensureSessionId('survey-1')).toBe(first)
    expect(readSessionId('survey-1')).toBe(first)
  })

  /**
   * Scoped per survey, not globally. A respondent answering two anonymous surveys
   * must not have the second one resume — or worse, overwrite — the first: the
   * endpoint keys an anonymous response on `(survey_id, session_id)`, so a shared id
   * across surveys is only saved from collision by the survey id in the key.
   */
  it('keeps a separate id per survey', () => {
    expect(ensureSessionId('survey-1')).not.toBe(ensureSessionId('survey-2'))
  })

  it('forgets the id once its response is complete', () => {
    const id = ensureSessionId('survey-1')
    clearSessionId('survey-1')
    expect(readSessionId('survey-1')).toBeNull()
    expect(ensureSessionId('survey-1')).not.toBe(id)
  })

  it('reports no id for a survey that has never been opened', () => {
    expect(readSessionId('never-seen')).toBeNull()
  })

  /**
   * `localStorage` throws outright in some privacy modes. Being unable to *resume* is
   * an acceptable degradation; being unable to *answer* is not, so every path returns
   * a usable id rather than propagating.
   */
  it('still yields a usable id when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(readSessionId('survey-1')).toBeNull()
    expect(ensureSessionId('survey-1')).toBeTruthy()
    expect(() => clearSessionId('survey-1')).not.toThrow()
  })
})
