/**
 * What a list too narrow for the floor would become with its neighbouring values merged in
 * pairs — the *Campos demográficos* artboard's "no se ofrece · con 5 rangos serían 8 por
 * valor", derived rather than typed. Nine five-year age bands over 42 people hold
 * ⌊42 ÷ 9⌋ = 4 each, under the floor; merged into ten-year bands they are ⌈9 ÷ 2⌉ = 5 ranges
 * of ⌊42 ÷ 5⌋ = 8.
 *
 * Halving is the step a list of ranges actually takes (two adjacent bands become one), and it
 * stops at the first count whose whole-number mean clears the floor — the same
 * `⌊people ÷ values⌋` the «Personas por valor» column prints (`peoplePerValue`), so the
 * suggestion and the column can never disagree. The mean says a cut *can* clear the floor,
 * never that it does (`demographicReach.ts`): every real cut is still checked cell by cell when
 * it is rendered.
 *
 * `null` when no merge clears it — fewer than two ranges would remain, and a one-value list
 * divides nothing — or when the headcount is not a number.
 */
export function mergedRanges(people: number, values: number, floor: number): { ranges: number; perValue: number } | null {
  if (!Number.isFinite(people) || people < 0 || !Number.isInteger(values) || values < 2 || floor <= 0) return null
  let ranges = values
  while (ranges >= 2 && Math.floor(people / ranges) < floor) ranges = Math.ceil(ranges / 2)
  return ranges >= 2 ? { ranges, perValue: Math.floor(people / ranges) } : null
}
