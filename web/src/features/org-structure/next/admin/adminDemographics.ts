/**
 * The most values a list can have and still clear the floor on average over `people`
 * — `⌊people ÷ floor⌋` — and the whole people per value it would then hold: the
 * *Campos demográficos* artboard's "no se ofrece · con 5 rangos serían 8 por valor",
 * derived rather than typed. `null` when not even two values would (a one-value list
 * divides nothing).
 */
export function widestUsable(people: number, floor: number): { values: number; perValue: number } | null {
  if (!Number.isFinite(people) || floor <= 0) return null
  const values = Math.floor(people / floor)
  if (values < 2) return null
  return { values, perValue: Math.floor(people / values) }
}
