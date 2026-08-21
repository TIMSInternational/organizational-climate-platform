import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react'
import type { ChipTone } from '../../components/ui'
import type { SemaforoCounts } from './api/trackingApi'

/**
 * The semáforo vocabulary, and the rule that a state is never a colour alone.
 *
 * ## Why this is a module and not three ternaries in two pages
 *
 * The client's spec §7 describes the audience for these screens: a population with
 * over thirty years' tenure and low digital literacy. The semáforo is their PRIMARY
 * reading mode — it is how the whole tracking module is understood — so "red" has to
 * survive a monochrome print-out, a projector with the colour balance wrong, and a
 * reader with deuteranopia. WCAG 1.4.1 says the same thing more narrowly.
 *
 * Three things carry each state here, and every one of them is redundant with the
 * other two:
 *
 * 1. **A word.** `Chip` makes `label` a required `string` for exactly this reason
 *    (see `ui/chip.tsx`) — there is no icon-only form to reach for by accident.
 * 2. **A distinct outline.** Octagon (the stop sign), triangle (the warning
 *    triangle), circle (the tick). Those three silhouettes are separable at
 *    12px in pure black, which is the greyscale test.
 * 3. **A tone**, and only then the colour.
 *
 * `semaforo.test.ts` pins that the three icons are pairwise distinct and the three
 * tones are pairwise distinct, so collapsing two states onto one glyph — the way
 * this would actually regress — fails rather than merely looking a bit flat.
 *
 * ## The strings are keys, not copy
 *
 * `labelKey` rather than `label`, same contract as `navigation/navSections.ts`:
 * this is a `.ts` module and `i18n/noHardcodedStrings.test.ts` sweeps those now,
 * but more to the point these two pages are Spanish-first and the catalogue is
 * where that lives.
 */

/**
 * Worst first, and that order is load-bearing rather than alphabetical: the
 * counts row and the consolidado table both read left-to-right as "how much
 * trouble am I in", which is the question the screen exists to answer.
 *
 * The spellings are the wire format, not a display choice. `EstadoSemaforo` is a
 * C# enum serialised by `PlanResponse.From` as `plan.EstadoSemaforo.ToString()`,
 * so the payload carries exactly `"Rojo" | "Amarillo" | "Verde"` — capitalised,
 * unaccented, and in Spanish whatever locale the reader picked.
 */
export const SEMAFORO_ESTADOS = ['Rojo', 'Amarillo', 'Verde'] as const

export type SemaforoEstado = (typeof SEMAFORO_ESTADOS)[number]

export interface SemaforoPresentation {
  /** Which `Chip` tone. Never the only carrier of the state — see the module note. */
  tone: ChipTone
  /**
   * The glyph, chosen for its OUTLINE rather than its colour. Typed as an SVG
   * component for the same reason `NavItem.icon` is: callers set `className` and
   * `aria-hidden` on it.
   */
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  /** Catalogue path for the word. */
  labelKey: string
  /**
   * Catalogue path for the line under the count in the summary strip — what this
   * state MEANS, in the reader's own terms ("vencido o sin avance").
   *
   * A key on the record rather than an interpolated `tracking.semaforoSub${estado}`
   * at the call site: `i18n/keysExist.test.ts` skips a computed key as dynamic, so
   * an interpolated one is invisible to the guard. Spelled out here it is a value
   * `semaforo.test.ts` can sweep in every locale alongside `labelKey`.
   */
  subKey: string
  /** The matching field on `SemaforoCounts`, which the API spells in lower case. */
  countKey: keyof SemaforoCounts
}

export const SEMAFORO_PRESENTATION: Record<SemaforoEstado, SemaforoPresentation> = {
  Rojo: {
    tone: 'critical',
    icon: OctagonAlert,
    labelKey: 'tracking.semaforoRojo',
    subKey: 'tracking.semaforoSubRojo',
    countKey: 'rojo',
  },
  Amarillo: {
    tone: 'warning',
    icon: TriangleAlert,
    labelKey: 'tracking.semaforoAmarillo',
    subKey: 'tracking.semaforoSubAmarillo',
    countKey: 'amarillo',
  },
  Verde: {
    tone: 'good',
    icon: CircleCheck,
    labelKey: 'tracking.semaforoVerde',
    subKey: 'tracking.semaforoSubVerde',
    countKey: 'verde',
  },
}

/**
 * The wire value as one of the three states, or `null` for anything else.
 *
 * `null` rather than a "Verde" default, deliberately. A state this build has never
 * heard of is not the good one — `EstadoSemaforo` could gain a member, and a
 * dashboard that silently paints an unknown state green is the kind of confidently
 * wrong reading the client's audience has no way to challenge. Callers render the
 * raw value in a neutral chip instead, which says "we do not know" out loud.
 */
export function parseSemaforo(raw: string): SemaforoEstado | null {
  return (SEMAFORO_ESTADOS as readonly string[]).includes(raw) ? (raw as SemaforoEstado) : null
}

/** How many plans this nodo (or the whole company) has in `estado`. */
export function semaforoCount(counts: SemaforoCounts, estado: SemaforoEstado): number {
  return counts[SEMAFORO_PRESENTATION[estado].countKey]
}

/**
 * Every plan the counts describe.
 *
 * Derived from the three counts rather than read from `NodoConsolidado.totalPlanes`,
 * so the two can be compared: `DashboardEndpoints.CountSemaforo` counts the same
 * list `g.Count()` measures, so they must agree, and the tablero has no
 * `totalPlanes` field at all.
 */
export function totalPlanes(counts: SemaforoCounts): number {
  return counts.rojo + counts.amarillo + counts.verde
}
