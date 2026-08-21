import type { ChipTone } from '../../components/ui'

/**
 * The semáforo vocabulary, and the 0–1 ↔ 0–100 conversion that sits between the
 * tracking API and every screen in this feature.
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
 * `toPercent` on the way out of the API, `fromPercent` on the way back in.
 * Nothing in `pages/` or `components/` is allowed to multiply by 100 itself —
 * that duplication is exactly how one screen ends up posting `50` for "50%" and
 * getting a 400 from a service that wanted `0.5`.
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
}

const PRESENTATION: Record<SemaforoEstado, SemaforoPresentation> = {
  Rojo: { estado: 'Rojo', tone: 'critical', shape: 'octagon', labelKey: 'tracking.semaforo.rojo' },
  Amarillo: {
    estado: 'Amarillo',
    tone: 'warning',
    shape: 'triangle',
    labelKey: 'tracking.semaforo.amarillo',
  },
  Verde: { estado: 'Verde', tone: 'good', shape: 'circle', labelKey: 'tracking.semaforo.verde' },
}

/** Every state, in worst-first order — the order a leader wants to triage in. */
export const SEMAFORO_ORDER: readonly SemaforoEstado[] = ['Rojo', 'Amarillo', 'Verde']

/**
 * The wire value as a known state, or `null`.
 *
 * `PlanResponse.EstadoSemaforo` is `plan.EstadoSemaforo.ToString()` — a string,
 * not a closed union, so a state added on the service side arrives here as a word
 * this build has never seen. Returning `null` lets the caller render the raw value
 * as neutral text instead of silently colouring an unknown state green.
 */
export function toSemaforoEstado(raw: string): SemaforoEstado | null {
  return raw === 'Rojo' || raw === 'Amarillo' || raw === 'Verde' ? raw : null
}

/** How to draw a known state. */
export function semaforoPresentation(estado: SemaforoEstado): SemaforoPresentation {
  return PRESENTATION[estado]
}

/**
 * A stored fraction as a whole percentage for display.
 *
 * Clamped as well as scaled: a service that ever answered `1.4` would otherwise
 * put a 140% bar on screen, and `Progress` would draw its indicator past the end
 * of its own track.
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
