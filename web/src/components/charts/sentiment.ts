/**
 * Sentiment share arithmetic for `SentimentVisualization`.
 */

export interface SentimentCounts {
  positive: number
  neutral: number
  negative: number
}

export interface SentimentShare {
  count: number
  /** Fraction of the total, 0–1. */
  share: number
}

export interface SentimentBreakdown {
  total: number
  positive: SentimentShare
  neutral: SentimentShare
  negative: SentimentShare
  /**
   * Net sentiment in -1..1: `(positive - negative) / total`.
   *
   * Neutral responses deliberately count towards the denominator but not the
   * numerator, so "mostly neutral" scores near zero rather than being ignored —
   * 10 positive out of 10 is +1.0, but 10 positive and 90 neutral is +0.1, which
   * is the honest reading.
   */
  netScore: number
}

/** A count that is not a count contributes nothing, rather than poisoning the total. */
function clean(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Shares and net score from raw counts.
 *
 * The total is always the sum. Legacy accepted an optional `total` prop and used
 * `data.total || data.positive + data.neutral + data.negative` as the denominator,
 * so a caller passing a total smaller than the sum produced shares adding up to
 * more than 100% — three bars overflowing their track with no error anywhere. If a
 * caller has responses that are none of the three, that is a fourth category and
 * belongs in the type, not in a denominator override.
 */
export function sentimentBreakdown(counts: SentimentCounts): SentimentBreakdown {
  const positive = clean(counts.positive)
  const neutral = clean(counts.neutral)
  const negative = clean(counts.negative)
  const total = positive + neutral + negative

  const share = (count: number): SentimentShare => ({
    count,
    share: total === 0 ? 0 : count / total,
  })

  return {
    total,
    positive: share(positive),
    neutral: share(neutral),
    negative: share(negative),
    netScore: total === 0 ? 0 : (positive - negative) / total,
  }
}
