import { describe, expect, it } from 'vitest'
import { sentimentBreakdown } from './sentiment'

describe('sentimentBreakdown', () => {
  it('computes shares that sum to one', () => {
    const result = sentimentBreakdown({ positive: 50, neutral: 30, negative: 20 })
    expect(result.total).toBe(100)
    expect(result.positive.share).toBeCloseTo(0.5)
    expect(result.neutral.share).toBeCloseTo(0.3)
    expect(result.negative.share).toBeCloseTo(0.2)
    expect(
      result.positive.share + result.neutral.share + result.negative.share,
    ).toBeCloseTo(1)
  })

  /**
   * The total is always the sum. Legacy accepted an optional `total` prop and used
   * `data.total || sum` as the denominator, so a total smaller than the sum
   * produced shares over 100% — three bars overflowing their track, silently.
   */
  it('always derives the total from the counts', () => {
    const result = sentimentBreakdown({ positive: 10, neutral: 10, negative: 10 })
    expect(result.total).toBe(30)
  })

  describe('net score', () => {
    it('is +1 when everything is positive and -1 when everything is negative', () => {
      expect(sentimentBreakdown({ positive: 10, neutral: 0, negative: 0 }).netScore).toBe(1)
      expect(sentimentBreakdown({ positive: 0, neutral: 0, negative: 10 }).netScore).toBe(-1)
    })

    it('is zero when positive and negative balance', () => {
      expect(sentimentBreakdown({ positive: 10, neutral: 5, negative: 10 }).netScore).toBe(0)
    })

    /**
     * Neutral counts towards the denominator but not the numerator, so "mostly
     * neutral" scores near zero instead of being ignored. 10 positive out of 10 is
     * +1.0; 10 positive among 90 neutral is +0.1.
     */
    it('dilutes the score with neutral responses rather than discarding them', () => {
      expect(sentimentBreakdown({ positive: 10, neutral: 90, negative: 0 }).netScore).toBeCloseTo(
        0.1,
      )
    })
  })

  describe('degenerate input', () => {
    it('does not divide by zero when there are no responses', () => {
      const result = sentimentBreakdown({ positive: 0, neutral: 0, negative: 0 })
      expect(result.total).toBe(0)
      expect(result.netScore).toBe(0)
      expect(result.positive.share).toBe(0)
      expect(Number.isNaN(result.positive.share)).toBe(false)
    })

    /** A negative count is not a count; it must not reduce the total. */
    it('ignores negative counts instead of subtracting them', () => {
      const result = sentimentBreakdown({ positive: 10, neutral: -5, negative: 0 })
      expect(result.total).toBe(10)
      expect(result.neutral.count).toBe(0)
    })

    it('ignores non-finite counts', () => {
      const result = sentimentBreakdown({
        positive: 10,
        neutral: Number.NaN,
        negative: Number.POSITIVE_INFINITY,
      })
      expect(result.total).toBe(10)
      expect(Number.isNaN(result.netScore)).toBe(false)
      expect(result.netScore).toBe(1)
    })
  })
})
