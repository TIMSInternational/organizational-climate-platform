import {
  SCALE_MAX,
  SCALE_MIN,
  bandName,
  bandRange,
  boundaryText,
  type ResultBandKey,
  type ResultBands,
} from '../../../../components/charts'
import type { TranslateFn } from '../../../../i18n/translate'

/**
 * The "Escala de resultados" card as the controls hold it: three names and the four edges
 * a person may move, as TEXT — what is in the box, in the reader's own decimal comma — so
 * a half-typed "3," is held, shown and judged rather than coerced. The two outer edges,
 * 1,00 and 5,00, are fixed and are not in the draft at all.
 */
export interface BandsDraft {
  names: Record<ResultBandKey, string>
  criticalMax: string
  opportunityMin: string
  opportunityMax: string
  strengthMin: string
}

/** The longest name the API keeps (`ResultBandsValidation.MaxNameLength`). */
export const MAX_NAME_LENGTH = 60

export function bandsDraftOf(bands: ResultBands, t: TranslateFn, locale: string): BandsDraft {
  const critical = bandRange('critical', bands)
  const opportunity = bandRange('opportunity', bands)
  return {
    // A default name is shown as the words it reads as, so the box is never empty; saving
    // it unchanged keeps it the default (`namesOut`), so it still follows the reader's language.
    names: {
      critical: bandName('critical', bands, t),
      opportunity: bandName('opportunity', bands, t),
      strength: bandName('strength', bands, t),
    },
    criticalMax: boundaryText(critical.max, locale),
    opportunityMin: boundaryText(opportunity.min, locale),
    opportunityMax: boundaryText(opportunity.max, locale),
    strengthMin: boundaryText(bands.strengthMin, locale),
  }
}

/** A typed edge: a number on the scale with at most two decimals, either decimal mark. */
export function parseBoundary(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value >= SCALE_MIN && value <= SCALE_MAX ? value : null
}

export type BandsProblem =
  | { kind: 'invalid'; field: keyof Omit<BandsDraft, 'names'>; text: string }
  | { kind: 'gap'; from: number; to: number; fields: (keyof Omit<BandsDraft, 'names'>)[] }
  | { kind: 'overlap'; from: number; to: number; fields: (keyof Omit<BandsDraft, 'names'>)[] }
  | { kind: 'inverted'; band: ResultBandKey; min: number; max: number; fields: (keyof Omit<BandsDraft, 'names'>)[] }
  | { kind: 'nameTooLong'; band: ResultBandKey }

export type BandsVerdict =
  | { ok: true; opportunityMin: number; strengthMin: number }
  | { ok: false; problems: BandsProblem[]; edges: Partial<Record<keyof Omit<BandsDraft, 'names'>, number>> }

const cents = (value: number) => Math.round(value * 100)

/**
 * Whether the three areas cover 1,00 to 5,00 with no gap and no overlap, at two decimals:
 * critical 1,00–A, opportunity B–C, strength D–5,00 is a scale exactly when B = A + 0,01 and
 * D = C + 0,01 and each area holds at least its own first value. Judged in hundredths, so no
 * float can open a gap of 0,0000001 between 2,99 and 3,00.
 */
export function judgeBands(draft: BandsDraft): BandsVerdict {
  const problems: BandsProblem[] = []
  const fields = ['criticalMax', 'opportunityMin', 'opportunityMax', 'strengthMin'] as const
  const edges: Partial<Record<(typeof fields)[number], number>> = {}
  for (const field of fields) {
    const value = parseBoundary(draft[field])
    if (value === null) problems.push({ kind: 'invalid', field, text: draft[field] })
    else edges[field] = value
  }
  for (const band of ['critical', 'opportunity', 'strength'] as const) {
    if (draft.names[band].trim().length > MAX_NAME_LENGTH) problems.push({ kind: 'nameTooLong', band })
  }
  const { criticalMax, opportunityMin, opportunityMax, strengthMin } = edges
  if (criticalMax !== undefined && cents(criticalMax) < cents(SCALE_MIN)) {
    problems.push({ kind: 'inverted', band: 'critical', min: SCALE_MIN, max: criticalMax, fields: ['criticalMax'] })
  }
  if (opportunityMin !== undefined && opportunityMax !== undefined && cents(opportunityMax) < cents(opportunityMin)) {
    problems.push({
      kind: 'inverted',
      band: 'opportunity',
      min: opportunityMin,
      max: opportunityMax,
      fields: ['opportunityMin', 'opportunityMax'],
    })
  }
  if (strengthMin !== undefined && cents(strengthMin) > cents(SCALE_MAX)) {
    problems.push({ kind: 'inverted', band: 'strength', min: strengthMin, max: SCALE_MAX, fields: ['strengthMin'] })
  }
  const seam = (lowMax: number | undefined, highMin: number | undefined, lowField: (typeof fields)[number], highField: (typeof fields)[number]) => {
    if (lowMax === undefined || highMin === undefined) return
    const step = cents(highMin) - cents(lowMax)
    if (step > 1) problems.push({ kind: 'gap', from: lowMax, to: highMin, fields: [lowField, highField] })
    else if (step < 1) problems.push({ kind: 'overlap', from: highMin, to: lowMax, fields: [lowField, highField] })
  }
  seam(criticalMax, opportunityMin, 'criticalMax', 'opportunityMin')
  seam(opportunityMax, strengthMin, 'opportunityMax', 'strengthMin')
  if (problems.length > 0 || opportunityMin === undefined || strengthMin === undefined) {
    return { ok: false, problems, edges }
  }
  return { ok: true, opportunityMin, strengthMin }
}

/** The names to save: a name left as the product's default words is saved as "the default". */
export function namesOut(draft: BandsDraft, t: TranslateFn): Record<ResultBandKey, string | null> {
  const out = (band: ResultBandKey) => {
    const name = draft.names[band].trim()
    return name === '' || name === t(`resultBands.name.${band}`) ? null : name
  }
  return { critical: out('critical'), opportunity: out('opportunity'), strength: out('strength') }
}

/** The scale the draft would save, or `null` while it is not a valid scale. */
export function bandsOut(draft: BandsDraft, t: TranslateFn): ResultBands | null {
  const verdict = judgeBands(draft)
  if (!verdict.ok) return null
  return { opportunityMin: verdict.opportunityMin, strengthMin: verdict.strengthMin, names: namesOut(draft, t) }
}

/** Whether the draft says anything different from the scale the server holds. */
export function bandsChanged(saved: ResultBands, draft: BandsDraft, t: TranslateFn): boolean {
  const next = bandsOut(draft, t)
  if (next === null) return true
  return (
    cents(next.opportunityMin) !== cents(saved.opportunityMin) ||
    cents(next.strengthMin) !== cents(saved.strengthMin) ||
    (['critical', 'opportunity', 'strength'] as const).some((band) => next.names[band] !== saved.names[band])
  )
}

/** The smallest value a gap leaves in no area — the example the error names. */
export function gapExample(from: number, to: number): number {
  return Math.round(((from + to) / 2) * 100) / 100
}
