import { describe, it, expect } from 'vitest'
import {
  SEMAFORO_ORDER,
  fromPercent,
  semaforoPresentation,
  toPercent,
  toSemaforoEstado,
} from './semaforo'

/**
 * The two properties this module exists to hold:
 *
 * 1. The wire carries a FRACTION and the screen shows a PERCENTAGE, and the two
 *    conversions are inverses of each other.
 * 2. Colour is never the only signal — every state has its own shape and its own
 *    word, and no two share either.
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

  it('orders worst first, which is the order a leader triages in', () => {
    expect([...SEMAFORO_ORDER]).toEqual(['Rojo', 'Amarillo', 'Verde'])
  })
})
