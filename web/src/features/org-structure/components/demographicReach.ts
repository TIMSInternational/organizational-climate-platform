/**
 * How thin a demographic field cuts the company.
 *
 * ## Why the mean, and not an estimate of the smallest group
 *
 * Nothing on the platform reports how many people hold each value of a
 * demographic field: `GET /admin/demographic-fields` returns the definitions, and
 * `User` carries no demographics at all. So the size of the *smallest* group is
 * genuinely unknown here and this module does not pretend otherwise — it returns
 * the mean, `⌊people / values⌋`, which is arithmetic on two numbers the app
 * actually has.
 *
 * The mean is enough for the verdict the screen needs, in one direction only:
 *
 * - **mean < floor ⟹ smallest group < floor.** The smallest group can never
 *   exceed the mean, so a field whose mean is under the floor is *proved*
 *   unusable as a cut. No survey has to be run to know it.
 * - **mean ≥ floor ⟹ nothing.** The values may still be lopsided, and one of them
 *   may well be under the floor. The screen therefore says the cut *can* clear the
 *   floor, never that it does — and every actual cut is still checked cell by cell
 *   when it is rendered.
 *
 * Flooring before comparing is what keeps that implication exact: `⌊m⌋ < f` for
 * integer `f` is true exactly when `m < f`, so the rounding cannot turn a proof
 * into a guess in either direction.
 *
 * Its own module rather than a helper inside `DemographicFieldList.tsx` for the
 * reason `charts/suppression.ts` gives: a `.tsx` file that exports a component and
 * a plain function trips `react(only-export-components)`, and the web lint budget
 * is a shared hard ceiling.
 */

/**
 * Mean people per value, or `null` when there is no meaningful answer — no
 * values to divide by, or a headcount that is not a usable number.
 *
 * `null` rather than `0`, because zero is a measurement and "there is nothing to
 * measure" is not one: a field with no options has not been found to reach nobody,
 * it has no groups to reach anyone with.
 */
export function peoplePerValue(people: number, values: number): number | null {
  if (!Number.isFinite(people) || people < 0) return null
  if (!Number.isInteger(values) || values <= 0) return null
  return Math.floor(people / values)
}
