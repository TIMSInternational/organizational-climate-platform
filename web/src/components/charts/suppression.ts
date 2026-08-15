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

/**
 * The diagonal hatch that says *withheld* rather than *empty* — one value, because
 * it shipped as two.
 *
 * `ProtectedCell` paints the cell and `ClimateMap`'s legend paints the key that
 * explains it. Both hand-rolled the same gradient, and when the cell's stripe token
 * was corrected the legend's copy was left behind on `--admin-border-light`, which
 * in the dark palette is the *same hex* as the surface it sits on
 * (`--admin-bg-icon-box`, `#2a2a2a`). So the fixed cell showed a hatch while the key
 * beside it rendered a blank box — a legend disagreeing with the thing it is a
 * legend for, which is worse than either being wrong alone.
 *
 * `--admin-border-hover` (`#d0d0d0` light / `#444444` dark) is a visible texture
 * against that surface in both themes. `protectedHatch.test.ts` reads the token out
 * of this constant, measures it against the surface, and sweeps `src/` so a third
 * hand-rolled copy fails instead of quietly diverging again.
 */
export const PROTECTED_HATCH =
  '[background-image:repeating-linear-gradient(135deg,var(--admin-border-hover)_0_5px,transparent_5px_10px)]'
