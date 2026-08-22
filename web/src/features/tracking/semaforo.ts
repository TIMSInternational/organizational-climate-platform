import type { ChipTone } from '../../components/ui'
import type { SemaforoCounts } from './api/trackingApi'

/**
 * The semáforo vocabulary, the 0–1 ↔ 0–100 conversion, and the counts helpers —
 * ONE table and ONE conversion for the whole tracking module.
 *
 * ## Why this file says "one" so insistently
 *
 * #125 (the two aggregate dashboards) and #126 (the planes-acción screens) were
 * built in parallel and each grew its own copy of this module: two shape tables,
 * two parsers, two state orders, and — in `trackingUnits.ts` — a second
 * fraction→percentage conversion. Every one of the surviving mutations the review
 * found lived in the gap between a pair of them: a guarantee tested on one copy
 * says nothing about the other, so `SemaforoSummary` could be reduced to three
 * bare coloured dots while `semaforo.test.ts` stayed green, and a progress bar
 * could be handed a raw fraction while the figure beside it was converted.
 *
 * So: this is the only place that knows what a state looks like, and the only
 * place that multiplies or divides by 100. `trackingUnits.percentagePoints`
 * delegates to {@link toPercent} rather than scaling again, and every component
 * that draws a state reads {@link semaforoPresentation} rather than keeping a
 * local icon map. `semaforoTable.test.ts` fails if a second table appears.
 *
 * ## `porcentajeAvance` is a FRACTION on the wire
 *
 * `ClimateTracking.Domain.Entities.PlanDeAccion.RegistrarAvance` throws
 * `ArgumentOutOfRangeException("porcentaje_avance debe estar entre 0 y 1")` for
 * anything outside `[0, 1]`, `MarcarCumplido` writes the literal `1m`, and
 * `CalcularAvanceEsperado` compares against `hito / 100m` — so a milestone of 50
 * is stored as `0.5`. The client's JSON Schema says `minimum 0, maximum 1` too.
 * The functional document's "0-100%" is display units and nothing else.
 *
 * Every percentage a human reads or types therefore crosses this module:
 * {@link toPercent} on the way out of the API, {@link fromPercent} on the way back
 * in. Nothing in `pages/` or `components/` is allowed to multiply by 100 itself —
 * that duplication is exactly how one screen ends up posting `50` for "50%" and
 * getting a 400 from a service that wanted `0.5`, and how another ends up handing
 * `0.15` to a `Progress` that wanted `15`.
 *
 * ## Colour is never the signal
 *
 * The client's spec §7 describes an audience with 30+ years' tenure and low
 * digital literacy, and the printed reports are greyscale. So a semáforo state
 * carries three things that survive a monochrome photocopy — a distinct SILHOUETTE
 * (octagon / triangle / circle), a Spanish WORD, and only then a tone. `tone`
 * alone is never enough, which is why this table pairs `icon` and `labelKey` with
 * it rather than exporting a colour map.
 */

/** The three states of `ClimateTracking.Domain.Enums.EstadoSemaforo`. */
export type SemaforoEstado = 'Rojo' | 'Amarillo' | 'Verde'

/**
 * Which glyph draws a state. Names, not components, so this module stays a plain
 * `.ts` value module — `SemaforoChip.tsx` maps them to lucide icons.
 *
 * The three silhouettes are deliberately different SHAPES rather than three
 * coloured dots: an octagon, a triangle and a circle are still three different
 * marks after the colour is gone.
 */
export type SemaforoShape = 'octagon' | 'triangle' | 'circle'

export interface SemaforoPresentation {
  estado: SemaforoEstado
  tone: ChipTone
  shape: SemaforoShape
  /** Catalogue path for the word beside the shape. */
  labelKey: string
  /**
   * Catalogue path for the line under the count in the summary strip — what this
   * state MEANS in the reader's own terms ("vencido o sin avance"), rather than
   * only what it is called.
   *
   * A key on the record rather than an interpolated `tracking.semaforo.sub${estado}`
   * at the call site: `i18n/keysExist.test.ts` skips a computed key as dynamic, so
   * an interpolated one is invisible to the guard. Spelled out here it is a value
   * the tests can sweep in every locale alongside `labelKey`.
   */
  subKey: string
  /** The matching field on `SemaforoCounts`, which the API spells in lower case. */
  countKey: keyof SemaforoCounts
}

const PRESENTATION: Record<SemaforoEstado, SemaforoPresentation> = {
  Rojo: {
    estado: 'Rojo',
    tone: 'critical',
    shape: 'octagon',
    labelKey: 'tracking.semaforo.rojo',
    subKey: 'tracking.semaforo.subRojo',
    countKey: 'rojo',
  },
  Amarillo: {
    estado: 'Amarillo',
    tone: 'warning',
    shape: 'triangle',
    labelKey: 'tracking.semaforo.amarillo',
    subKey: 'tracking.semaforo.subAmarillo',
    countKey: 'amarillo',
  },
  Verde: {
    estado: 'Verde',
    tone: 'good',
    shape: 'circle',
    labelKey: 'tracking.semaforo.verde',
    subKey: 'tracking.semaforo.subVerde',
    countKey: 'verde',
  },
}

/**
 * Every state, in worst-first order — the order a leader wants to triage in.
 *
 * Load-bearing rather than alphabetical: the counts row and the consolidado table
 * both read left-to-right as "how much trouble am I in", which is the question
 * those screens exist to answer.
 *
 * The spellings are the wire format, not a display choice. `EstadoSemaforo` is a
 * C# enum serialised by `PlanResponse.From` as `plan.EstadoSemaforo.ToString()`,
 * so the payload carries exactly `"Rojo" | "Amarillo" | "Verde"` — capitalised,
 * unaccented, and in Spanish whatever locale the reader picked.
 */
export const SEMAFORO_ORDER: readonly SemaforoEstado[] = ['Rojo', 'Amarillo', 'Verde']

/**
 * The wire value as a known state, or `null`.
 *
 * `PlanResponse.EstadoSemaforo` is `plan.EstadoSemaforo.ToString()` — a string,
 * not a closed union, so a state added on the service side arrives here as a word
 * this build has never seen. Returning `null` lets the caller render the raw value
 * as neutral text instead of silently colouring an unknown state green: a state
 * this build has never heard of is not the good one, and a dashboard that paints
 * it green is the kind of confidently wrong reading the client's audience has no
 * way to challenge.
 */
export function toSemaforoEstado(raw: string): SemaforoEstado | null {
  return raw === 'Rojo' || raw === 'Amarillo' || raw === 'Verde' ? raw : null
}

/** How to draw a known state. The ONLY accessor of the table above. */
export function semaforoPresentation(estado: SemaforoEstado): SemaforoPresentation {
  return PRESENTATION[estado]
}

/**
 * How many plans this nodo (or the whole company) has in `estado`.
 *
 * Reads `countKey` off the presentation rather than lower-casing the state or
 * branching on it, so the state list and the counts payload cannot drift: adding a
 * fourth `EstadoSemaforo` means adding a row to the one table, and the type then
 * demands the matching `SemaforoCounts` field exists.
 */
export function semaforoCount(counts: SemaforoCounts, estado: SemaforoEstado): number {
  return counts[semaforoPresentation(estado).countKey]
}

/**
 * Every plan the counts describe.
 *
 * Derived from the three counts rather than read from `NodoConsolidado.totalPlanes`,
 * so the two can be compared: `DashboardEndpoints.CountSemaforo` counts the same
 * list `g.Count()` measures, so they must agree, and the tablero has no
 * `totalPlanes` field at all. {@link countsCoverTotal} is what checks that they do.
 */
export function totalPlanes(counts: SemaforoCounts): number {
  return counts.rojo + counts.amarillo + counts.verde
}

/**
 * The semáforo tally of a list of plans, for the screens the service does not
 * count for.
 *
 * `/consolidado` and `/tablero-seguimiento` return `conteos`; `/planes-accion` and
 * `/mis-tareas` return a bare list, so those two pages have to count what they can
 * see. They must not call the tablero to do it — that endpoint answers for ONE
 * nodo and 403s a non-admin asking about another, whereas these listings span
 * whatever set the caller is entitled to, so a fetched count would describe a
 * different population from the table underneath it.
 *
 * Both pages wrote this loop out inline, which made two more copies of the state
 * list — the third and fourth in the feature. Counted here off `countKey`, so the
 * states, the counts payload and the tally cannot drift apart.
 *
 * **An unknown state is counted in NOTHING**, deliberately. Adding it to `verde`
 * would invent good news; adding it to `rojo` would invent an emergency. It is
 * therefore possible for the three counts to sum to less than `plans.length`, and
 * that is a fact the caller must surface rather than hide — pass `plans.length` as
 * `SemaforoSummary`'s `total` and the strip discloses the shortfall. See
 * {@link countsCoverTotal}.
 */
export function tallySemaforo(plans: readonly { estadoSemaforo: string }[]): SemaforoCounts {
  const counts: SemaforoCounts = { rojo: 0, amarillo: 0, verde: 0 }
  for (const plan of plans) {
    const estado = toSemaforoEstado(plan.estadoSemaforo)
    if (estado !== null) counts[semaforoPresentation(estado).countKey] += 1
  }
  return counts
}

/**
 * Whether the three semáforo counts actually account for every plan the server
 * says exists.
 *
 * `CountSemaforo` tallies `Rojo`, `Amarillo` and `Verde`; `TotalPlanes` is
 * `g.Count()` over the same group. They agree today **because** `EstadoSemaforo`
 * has exactly three members — the moment it gains a fourth, a nodo with plans in
 * it reports `totalPlanes: 10` beside counts summing to 9, and the KPI strip
 * would quietly disagree with the table underneath it while both looked fine.
 *
 * Returning the fact rather than papering over it lets the strip say "3 of 10
 * plans are in a state this screen cannot show" instead of implying it counted
 * everything. `false` means the caller must disclose.
 */
export function countsCoverTotal(counts: SemaforoCounts, total: number | undefined): boolean {
  return total === undefined || totalPlanes(counts) === total
}

/**
 * A stored fraction as a whole percentage for display. The ONE conversion out of
 * wire units in this module — `trackingUnits.percentagePoints` calls this rather
 * than scaling a second time.
 *
 * Rounded as well as clamped, and both halves matter:
 *
 * - **Rounded**, because `0.07 * 100` is `7.000000000000001` in IEEE-754 and
 *   `formatMetric`'s default precision is "0 places for an integer, 1 otherwise".
 *   Unrounded, 8 of every 101 whole-percent values render `7,0 %` in a column
 *   whose neighbours read `8 %` — the same reading dressed two different ways.
 * - **Clamped**, because a service that ever answered `1.4` would otherwise put a
 *   140% bar on screen, and `Progress` would draw its indicator past the end of
 *   its own track.
 */
export function toPercent(porcentajeAvance: number): number {
  if (!Number.isFinite(porcentajeAvance)) return 0
  return Math.round(Math.min(1, Math.max(0, porcentajeAvance)) * 100)
}

/**
 * A typed percentage as the fraction the API accepts.
 *
 * Clamped to `[0, 1]` on this side too, so a slip in a number input becomes a
 * value the domain accepts rather than a 400 the user has to interpret. The
 * percentage is rounded to a whole number FIRST: `33.333 / 100` is a fraction
 * with no exact decimal representation, and this endpoint's parameter is a C#
 * `decimal`.
 */
export function fromPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.round(Math.min(100, Math.max(0, percent))) / 100
}
