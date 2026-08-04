import { describe, expect, it } from 'vitest'
import { MAX_SERIES } from './palette'
import {
  categoryColorKeyList,
  categoryColorKeys,
  OTHER_CATEGORY_KEY,
  WORD_SIZE_CLASSES,
  wordSizeClass,
} from './wordScale'

describe('wordSizeClass', () => {
  it('puts the least frequent word at the smallest step and the most frequent at the largest', () => {
    expect(wordSizeClass(10, 10, 100)).toBe(WORD_SIZE_CLASSES[0])
    expect(wordSizeClass(100, 10, 100)).toBe(WORD_SIZE_CLASSES[WORD_SIZE_CLASSES.length - 1])
  })

  it('returns a step from the token type scale, never a pixel size', () => {
    for (const value of [10, 25, 50, 75, 100]) {
      expect(WORD_SIZE_CLASSES).toContain(wordSizeClass(value, 10, 100))
    }
  })

  /**
   * The square-root mapping. A reader judges a word by its area, and area grows
   * with the square of the font size — so a linear map (what both legacy versions
   * did) makes a word mentioned twice as often look four times as important.
   *
   * The observable consequence: the *midpoint* of the range sits above the middle
   * step, because sqrt(0.5) is 0.71, not 0.5.
   */
  it('scales by area, not by height', () => {
    const middleStep = Math.floor(WORD_SIZE_CLASSES.length / 2)
    const steps: readonly string[] = WORD_SIZE_CLASSES
    const atMidpoint = steps.indexOf(wordSizeClass(50, 0, 100))
    expect(atMidpoint).toBeGreaterThan(middleStep)
  })

  /** A flat dataset has no ranking to show, so one uniform middle size is honest. */
  it('puts every word at the middle step when all frequencies are equal', () => {
    const middle = WORD_SIZE_CLASSES[Math.floor(WORD_SIZE_CLASSES.length / 2)]
    expect(wordSizeClass(7, 7, 7)).toBe(middle)
  })

  it('clamps rather than throwing for a value outside the range', () => {
    expect(wordSizeClass(-5, 10, 100)).toBe(WORD_SIZE_CLASSES[0])
    expect(wordSizeClass(500, 10, 100)).toBe(WORD_SIZE_CLASSES[WORD_SIZE_CLASSES.length - 1])
  })

  it('does not throw on a non-finite value', () => {
    expect(WORD_SIZE_CLASSES).toContain(wordSizeClass(Number.NaN, 0, 100))
  })
})

describe('categoryColorKeys', () => {
  it('gives each category its own key while they fit in the palette', () => {
    const mapping = categoryColorKeys(['Culture', 'Teamwork', 'Growth'])
    expect(mapping.get('Culture')).toBe('Culture')
    expect(mapping.get('Growth')).toBe('Growth')
    expect(categoryColorKeyList(mapping)).toEqual(['Culture', 'Teamwork', 'Growth'])
  })

  it('deduplicates repeated categories', () => {
    const mapping = categoryColorKeys(['A', 'B', 'A'])
    expect(categoryColorKeyList(mapping)).toEqual(['A', 'B'])
  })

  /**
   * `seriesColor` throws past six rather than cycling, so a seventh category cannot
   * be given a colour of its own. Folding is the same answer `foldSlices` gives a
   * pie chart: two categories sharing a colour under a label that says "the rest"
   * is honest; two sharing one while both claim their own name is not.
   */
  it('folds categories past the palette ceiling into one bucket', () => {
    const many = Array.from({ length: MAX_SERIES + 3 }, (_, index) => `C${index}`)
    const mapping = categoryColorKeys(many)
    const keys = categoryColorKeyList(mapping)

    expect(keys).toHaveLength(MAX_SERIES)
    expect(keys.at(-1)).toBe(OTHER_CATEGORY_KEY)
    // The first five keep their identity; everything from the sixth folds.
    expect(mapping.get('C0')).toBe('C0')
    expect(mapping.get('C4')).toBe('C4')
    expect(mapping.get('C5')).toBe(OTHER_CATEGORY_KEY)
    expect(mapping.get(`C${MAX_SERIES + 2}`)).toBe(OTHER_CATEGORY_KEY)
  })

  it('does not fold at exactly the ceiling', () => {
    const exactly = Array.from({ length: MAX_SERIES }, (_, index) => `C${index}`)
    const keys = categoryColorKeyList(categoryColorKeys(exactly))
    expect(keys).toHaveLength(MAX_SERIES)
    expect(keys).not.toContain(OTHER_CATEGORY_KEY)
  })

  /**
   * Order is first appearance, not frequency, so a colour follows a category rather
   * than its current rank — the `seriesColorFor` rule. If this ordered by anything
   * derived from the data, filtering would repaint the survivors.
   */
  it('assigns keys in first-appearance order', () => {
    const mapping = categoryColorKeys(['Zeta', 'Alpha', 'Zeta', 'Mu'])
    expect(categoryColorKeyList(mapping)).toEqual(['Zeta', 'Alpha', 'Mu'])
  })

  it('produces a key list with no duplicates, so seriesColorFor cannot collide', () => {
    const mapping = categoryColorKeys(
      Array.from({ length: MAX_SERIES + 5 }, (_, index) => `C${index}`),
    )
    const keys = categoryColorKeyList(mapping)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
