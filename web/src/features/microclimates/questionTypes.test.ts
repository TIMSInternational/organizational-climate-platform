import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUESTION_TYPE,
  NUMERIC_SCALE_TYPES,
  QUESTION_TYPES,
  isNumericScale,
} from './questionTypes'

/**
 * #196. There is no build-time link between this list and the backend's
 * `QuestionTypes.ForMicroclimate`, so this file is the thing that makes a divergence
 * deliberate. If the backend set changes, this test fails and someone has to look at
 * both sides -- which is exactly what did not happen when `open_text` drifted away
 * from legacy's `open_ended`.
 */
describe('microclimate question types', () => {
  it('matches the backend ForMicroclimate set exactly', () => {
    // Mirror of ClimateProject.Application.Questions.QuestionTypes.ForMicroclimate.
    // Order-independent: the backend orders for readability, the <select> for the UI.
    expect([...QUESTION_TYPES].sort()).toEqual(
      ['likert', 'multiple_choice', 'open_ended', 'rating', 'yes_no', 'emoji_rating'].sort(),
    )
  })

  it('does not contain open_text', () => {
    // A target-only invention, renamed to open_ended and migrated. An explicit
    // rejection so a well-meaning revert fails loudly.
    expect(QUESTION_TYPES).not.toContain('open_text')
  })

  it('defaults a new question to free text', () => {
    expect(DEFAULT_QUESTION_TYPE).toBe('open_ended')
    expect(QUESTION_TYPES).toContain(DEFAULT_QUESTION_TYPE)
  })

  it('treats likert and rating as the numeric-scale types', () => {
    expect([...NUMERIC_SCALE_TYPES].sort()).toEqual(['likert', 'rating'])
    expect(isNumericScale('likert')).toBe(true)
    expect(isNumericScale('rating')).toBe(true)
  })

  it('does not treat constrained or free-text types as numeric scales', () => {
    expect(isNumericScale('multiple_choice')).toBe(false)
    expect(isNumericScale('yes_no')).toBe(false)
    expect(isNumericScale('open_ended')).toBe(false)
    expect(isNumericScale('')).toBe(false)
    expect(isNumericScale('emoji_rating')).toBe(false)
  })

  it('draws every numeric-scale type from the vocabulary', () => {
    // Guard the guard: passes vacuously if NUMERIC_SCALE_TYPES were empty.
    expect(NUMERIC_SCALE_TYPES.length).toBeGreaterThan(0)
    for (const type of NUMERIC_SCALE_TYPES) {
      expect(QUESTION_TYPES).toContain(type)
    }
  })

  it('offers emoji_rating, whose emoji set now has storage', () => {
    // The opposite of what used to be asserted here (#198). This list refused
    // emoji_rating because MicroclimateQuestion had only a flat options array and
    // QuestionEmojiOption was keyed to survey questions, so offering it would have
    // created unanswerable questions. `microclimate_question_emoji_options` is that
    // storage, and the type is in `QuestionTypes.ForMicroclimate` now -- so the pin is
    // turned around rather than deleted, and still fails if the two sides drift.
    expect(QUESTION_TYPES).toContain('emoji_rating')
  })

  it('does not treat emoji_rating as a numeric scale', () => {
    // It is answered on ITS OWN configured values, which may be -1..1 or 1..4 and are
    // not the 1-5 run `isNumericScale` selects the SegmentedScale for. The respond page
    // has a dedicated branch, and `MicroclimateEndpoints` validates it against the
    // question's own emoji values with no 1-5 fallback.
    expect(isNumericScale('emoji_rating')).toBe(false)
    expect(NUMERIC_SCALE_TYPES).not.toContain('emoji_rating')
  })
})
