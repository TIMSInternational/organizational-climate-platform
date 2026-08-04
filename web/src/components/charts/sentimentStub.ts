import type { SentimentCounts } from './sentiment'

/**
 * PLACEHOLDER DATA — there is no sentiment analysis in this product yet.
 *
 * Sentiment requires an AI provider, and that decision is **#67**, which is open
 * and blocked on the client (a monthly cost ceiling, and sign-off on dropping
 * attrition prediction). Until it lands there is no endpoint to call, so
 * `SentimentVisualization` was built against this instead — the component is real
 * and finished, the numbers are invented.
 *
 * ## Why this is a separate module
 *
 * So it is trivially findable and deletable. When #67 lands, `grep sentimentStub`
 * names every place that has to change, and removing this file makes any survivor
 * a compile error rather than a page that quietly keeps showing fabricated
 * numbers. Inlining these counts in a page or defaulting a prop to them would let
 * a stub reach production looking exactly like data.
 *
 * **Never import this from a page that a customer can reach.** Its only caller
 * should be the chart gallery and tests.
 */
export const SENTIMENT_STUB: SentimentCounts = {
  positive: 156,
  neutral: 89,
  negative: 23,
}

/** Loud enough to be recognised on screen as not-real. */
export const SENTIMENT_STUB_IS_PLACEHOLDER = true
