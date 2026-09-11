import { describe, expect, it } from 'vitest'
import type { DemographicField } from '../../api/demographicFields'
import { fieldVerdict, isUsableCut, keyFromLabel, meanPerValue, tippingPoint, usableCuts } from './demographics'

// Grupo Meridiano S.A. has 42 active people (`GET /dashboard/company-admin`, 10 Sep 2026).
const PEOPLE = 42
const FLOOR = 5

function field(values: number, extra: Partial<DemographicField> = {}): DemographicField {
  return {
    id: `f${values}`,
    companyId: 'm',
    field: `f${values}`,
    label: 'Antigüedad',
    type: 'select',
    options: Array.from({ length: values }, (_, index) => ({ order: index, value: `v${index}`, label: `V${index}` })),
    required: false,
    order: 1,
    isActive: true,
    resolvedLocale: 'es',
    fallbackFields: [],
    ...extra,
  }
}

describe('meanPerValue', () => {
  it('is the unrounded mean the canvas prints, and nothing without values', () => {
    expect(meanPerValue(PEOPLE, 4)).toBe(10.5)
    expect(meanPerValue(PEOPLE, 0)).toBeNull()
  })
})

describe('isUsableCut', () => {
  it('clears 42 people across 4 values (10,5) and 8 values (5,25), and not across 9 (4,7)', () => {
    expect(isUsableCut(PEOPLE, 4, FLOOR)).toBe(true)
    expect(isUsableCut(PEOPLE, 8, FLOOR)).toBe(true)
    expect(isUsableCut(PEOPLE, 9, FLOOR)).toBe(false)
  })
})

describe('tippingPoint', () => {
  it('is the canvas’s "con 9 valores" for 42 people', () => {
    expect(tippingPoint(PEOPLE, 4, FLOOR)).toBe(9)
  })

  it('is exact at a multiple of the floor: 40 people stop clearing it at 9 values, not 8', () => {
    expect(tippingPoint(40, 1, FLOOR)).toBe(9)
    expect(isUsableCut(40, 8, FLOOR)).toBe(true)
  })

  it('is absent once past it, or when no list could ever clear the floor', () => {
    expect(tippingPoint(PEOPLE, 9, FLOOR)).toBeNull()
    expect(tippingPoint(4, 1, FLOOR)).toBeNull()
  })
})

describe('fieldVerdict and usableCuts', () => {
  it('judges only a list, and only with a headcount', () => {
    expect(fieldVerdict(field(4), PEOPLE, FLOOR)).toBe('usable')
    expect(fieldVerdict(field(9), PEOPLE, FLOOR)).toBe('narrow')
    expect(fieldVerdict(field(0, { type: 'text', options: null }), PEOPLE, FLOOR)).toBe('not-a-cut')
    expect(fieldVerdict(field(4), undefined, FLOOR)).toBe('unknown')
  })

  it('counts a cut as usable only when it is active, a list, and clears the floor', () => {
    const fields = [field(4), field(3, { isActive: false }), field(9), field(0, { type: 'date', options: null })]
    expect(usableCuts(fields, PEOPLE, FLOOR)).toBe(1)
  })
})

describe('keyFromLabel', () => {
  it('folds accents and joins words, as "Antigüedad" becomes "antiguedad"', () => {
    expect(keyFromLabel('Antigüedad')).toBe('antiguedad')
    expect(keyFromLabel('Nivel educativo')).toBe('nivel_educativo')
    expect(keyFromLabel('  ¿Área?  ')).toBe('area')
  })
})
