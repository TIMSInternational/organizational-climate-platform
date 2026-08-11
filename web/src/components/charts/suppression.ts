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

/**
 * The floor itself, as a number the product can show as well as enforce.
 *
 * Company Settings renders this value as a *locked* control — the redesign's
 * point being that the guarantee is only credible if the number you are promised
 * is demonstrably the number the code applies. A page that wrote its own `5`
 * beside a predicate that defaulted to some other value would be advertising a
 * promise nothing keeps, so both read this one constant.
 *
 * It is the platform *minimum*, not the whole rule: `isSuppressed` and
 * `ProtectedCell` both still take a `threshold`, because a company may be held to
 * a higher floor. Lower is what is refused.
 */
export const ANONYMITY_FLOOR = 5

/** Whether a reading is below the anonymity floor and must be withheld. */
export function isSuppressed(responses: number, threshold = ANONYMITY_FLOOR): boolean {
  return responses < threshold
}
