/**
 * The one plural rule the catalogues need: Spanish and English both say "1 pregunta" /
 * "1 question" and "0 preguntas" / "2 questions", so a count picks between two sibling keys.
 *
 * `translate.ts` does `{placeholder}` substitution only, and the convention since has been a
 * key pair — `xOne` for exactly 1, `x` (or `xMany`) for every other count, 0 included — chosen
 * at the call site. Several screens grew their own copy of this function; this is the shared
 * one, so a new count does not grow another.
 *
 * ```ts
 * t(byCount(days, 'tracking.next.overdueByOne', 'tracking.next.overdueBy'), { days })
 * ```
 */
export function byCount(count: number, oneKey: string, manyKey: string): string {
  return count === 1 ? oneKey : manyKey
}
