import { describe, it, expect } from 'vitest'
import {
  SEMAFORO_ORDER,
  countsCoverTotal,
  fromPercent,
  semaforoCount,
  semaforoPresentation,
  toPercent,
  toSemaforoEstado,
  totalPlanes,
} from './semaforo'
import { CATALOGUES, LOCALES } from '../../i18n/locale'
import type { MessageNode } from '../../i18n/translate'

/**
 * The properties this module exists to hold:
 *
 * 1. The wire carries a FRACTION and the screen shows a PERCENTAGE, and the two
 *    conversions are inverses of each other.
 * 2. Colour is never the only signal — every state has its own shape and its own
 *    word, and no two share either.
 * 3. The counts helpers read the same table, so the state list and the counts
 *    payload cannot drift apart.
 */
describe('porcentajeAvance is 0–1 on the wire and 0–100 on screen', () => {
  it('scales a stored fraction up for display', () => {
    // `PlanDeAccion.RegistrarAvance` rejects anything outside [0,1] and
    // `MarcarCumplido` writes the literal `1m`. Half done is `0.5`, not `50`.
    expect(toPercent(0)).toBe(0)
    expect(toPercent(0.5)).toBe(50)
    expect(toPercent(1)).toBe(100)
  })

  it('scales a typed percentage down for the request', () => {
    expect(fromPercent(0)).toBe(0)
    expect(fromPercent(60)).toBe(0.6)
    expect(fromPercent(100)).toBe(1)
  })

  it('round-trips every whole percentage', () => {
    // The guard against a half-fixed conversion: if either direction ever loses
    // the factor of 100, or gains a second one, this fails on every value but 0.
    for (let percent = 0; percent <= 100; percent += 1) {
      expect(toPercent(fromPercent(percent))).toBe(percent)
    }
  })

  /**
   * The defect this pins: `fraction * 100` is not the whole percentage it looks
   * like. IEEE-754 makes `0.07 * 100` exactly `7.000000000000001`, and
   * `formatMetric`'s default precision is "0 places if the value is an integer, 1
   * otherwise" — so an unrounded conversion renders `7,0 %` in a column whose
   * neighbours read `8 %`.
   *
   * Swept rather than spot-checked, because which values misbehave is a property
   * of binary floating point and not something a reader can predict: 8 of the 101
   * whole percentages are affected, and a test naming only 0.07 would pass a fix
   * that special-cased it.
   */
  it('returns a whole number for every whole percentage, with no float dust', () => {
    const dusty: string[] = []
    for (let percent = 0; percent <= 100; percent += 1) {
      const points = toPercent(percent / 100)
      if (!Number.isInteger(points)) dusty.push(`${percent}% -> ${points}`)
    }
    expect(dusty).toEqual([])
    // The specific value the review found, stated outright so the reason survives.
    expect(0.07 * 100).not.toBe(7)
    expect(toPercent(0.07)).toBe(7)
  })

  it('never produces a fraction the domain would refuse', () => {
    // `RegistrarAvance` throws ArgumentOutOfRangeException outside [0,1], which the
    // endpoint turns into a 400. A slip in a number field must not become one.
    expect(fromPercent(400)).toBe(1)
    expect(fromPercent(-20)).toBe(0)
    expect(fromPercent(Number.NaN)).toBe(0)
  })

  it('never draws a bar past the end of its own track', () => {
    expect(toPercent(1.4)).toBe(100)
    expect(toPercent(-0.2)).toBe(0)
    expect(toPercent(Number.NaN)).toBe(0)
  })

  it('rounds a fractional percentage before dividing', () => {
    // The endpoint's parameter is a C# `decimal`; 33.333/100 is not a decimal it
    // would round-trip cleanly, and the field asks for a whole percentage anyway.
    expect(fromPercent(33.4)).toBe(0.33)
    expect(fromPercent(33.6)).toBe(0.34)
  })
})

describe('semáforo states', () => {
  it('reads the three states EstadoSemaforo can serialise', () => {
    expect(toSemaforoEstado('Rojo')).toBe('Rojo')
    expect(toSemaforoEstado('Amarillo')).toBe('Amarillo')
    expect(toSemaforoEstado('Verde')).toBe('Verde')
  })

  it('refuses a state this build does not know', () => {
    // `PlanResponse.EstadoSemaforo` is `.ToString()` — an open string. A fourth
    // state must not be silently mapped onto one of these three.
    expect(toSemaforoEstado('Naranja')).toBeNull()
    expect(toSemaforoEstado('rojo')).toBeNull()
    expect(toSemaforoEstado('')).toBeNull()
  })

  it('gives every state its own SHAPE, so colour is never the only signal', () => {
    const shapes = SEMAFORO_ORDER.map((estado) => semaforoPresentation(estado).shape)
    expect(new Set(shapes).size).toBe(SEMAFORO_ORDER.length)
  })

  it('gives every state its own WORD as well as its own shape', () => {
    const labels = SEMAFORO_ORDER.map((estado) => semaforoPresentation(estado).labelKey)
    expect(new Set(labels).size).toBe(SEMAFORO_ORDER.length)
  })

  it('gives every state its own TONE', () => {
    const tones = SEMAFORO_ORDER.map((estado) => semaforoPresentation(estado).tone)
    expect(new Set(tones).size).toBe(SEMAFORO_ORDER.length)
  })

  it('orders worst first, which is the order a leader triages in', () => {
    expect([...SEMAFORO_ORDER]).toEqual(['Rojo', 'Amarillo', 'Verde'])
  })

  /**
   * Both catalogue keys on every row must resolve in EVERY locale. `labelKey` and
   * `subKey` are spelled out on the record rather than interpolated at the call
   * site precisely so this sweep can see them — `i18n/keysExist.test.ts` skips a
   * computed key as dynamic.
   */
  it('has a real translation for every label and sub-label in every locale', () => {
    const missing: string[] = []
    for (const locale of LOCALES) {
      for (const estado of SEMAFORO_ORDER) {
        const { labelKey, subKey } = semaforoPresentation(estado)
        for (const key of [labelKey, subKey]) {
          const value = key
            .split('.')
            .reduce<MessageNode | undefined>(
              (node, segment) =>
                typeof node === 'object' && node !== null ? node[segment] : undefined,
              CATALOGUES[locale] as MessageNode,
            )
          if (typeof value !== 'string' || value.trim() === '') missing.push(`${locale}:${key}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})

describe('the counts helpers read the same table as the presentation', () => {
  const counts = { rojo: 3, amarillo: 2, verde: 5 }

  it('reads each state off the counts payload', () => {
    expect(semaforoCount(counts, 'Rojo')).toBe(3)
    expect(semaforoCount(counts, 'Amarillo')).toBe(2)
    expect(semaforoCount(counts, 'Verde')).toBe(5)
  })

  it('maps every state to a DIFFERENT counts field', () => {
    // Two states sharing a `countKey` would show the same number twice and drop a
    // third — and would still typecheck, since all three keys have type `number`.
    const keys = SEMAFORO_ORDER.map((estado) => semaforoPresentation(estado).countKey)
    expect(new Set(keys).size).toBe(SEMAFORO_ORDER.length)
  })

  it('totals every plan the counts describe', () => {
    expect(totalPlanes(counts)).toBe(10)
    expect(totalPlanes({ rojo: 0, amarillo: 0, verde: 0 })).toBe(0)
  })

  /**
   * `TotalPlanes` is `g.Count()` and `CountSemaforo` tallies the three states, so
   * they agree only while `EstadoSemaforo` has exactly three members. The KPI
   * strip has to be able to notice when they do not.
   */
  it('reports whether the three counts account for the server total', () => {
    expect(countsCoverTotal(counts, 10)).toBe(true)
    expect(countsCoverTotal(counts, 11)).toBe(false)
    // No server total to compare against is not a disagreement — the tablero has
    // no `totalPlanes` field at all.
    expect(countsCoverTotal(counts, undefined)).toBe(true)
  })
})
