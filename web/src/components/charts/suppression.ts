/**
 * The anonymity-floor decision, on its own so that `ProtectedCell.tsx` exports a
 * component and nothing else.
 *
 * Splitting a one-line predicate into its own module looks fussy until you see the
 * lint rule behind it: `react(only-export-components)` fires when a file exports
 * both a component and a plain function, because it breaks Fast Refresh. The web
 * lint budget is a hard ceiling shared by every lane, so a warning that is
 * individually harmless is a warning the next person cannot afford.
 *
 * It is also the honest home for it — the rule is a policy about data, not about
 * rendering, and `ClimateMap` consults it to decide whether a whole row is
 * suppressed before it renders any cell at all.
 */

/** Whether a reading is below the anonymity floor and must be withheld. */
export function isSuppressed(responses: number, threshold = 5): boolean {
  return responses < threshold
}
