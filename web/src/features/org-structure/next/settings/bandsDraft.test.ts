import { describe, it, expect } from 'vitest'
import { createTranslator } from '../../../../i18n'
import es from '../../../../i18n/es.json'
import { DEFAULT_RESULT_BANDS } from '../../../../components/charts'
import { bandsChanged, bandsDraftOf, bandsOut, gapExample, judgeBands, parseBoundary, type BandsDraft } from './bandsDraft'

const t = createTranslator(es, es)
const fresh = (): BandsDraft => bandsDraftOf(DEFAULT_RESULT_BANDS, t, 'es')

describe('the result-scale draft', () => {
  it('shows the default scale as the boxes print it, in the reader’s decimal comma', () => {
    expect(fresh()).toEqual({
      names: { critical: 'Área crítica', opportunity: 'Área de oportunidad', strength: 'Área de fortaleza' },
      criticalMax: '2,99',
      opportunityMin: '3,00',
      opportunityMax: '3,99',
      strengthMin: '4,00',
    })
  })

  it('reads an edge typed with either decimal mark, on the scale, at most two decimals', () => {
    expect(parseBoundary('3,10')).toBe(3.1)
    expect(parseBoundary('3.1')).toBe(3.1)
    expect(parseBoundary(' 4 ')).toBe(4)
    expect(parseBoundary('3,105')).toBeNull()
    expect(parseBoundary('5,01')).toBeNull()
    expect(parseBoundary('0,99')).toBeNull()
    expect(parseBoundary('3,')).toBeNull()
    expect(parseBoundary('')).toBeNull()
  })

  it('accepts the default scale, and a moved one that stays contiguous', () => {
    expect(judgeBands(fresh())).toEqual({ ok: true, opportunityMin: 3, strengthMin: 4 })
    const moved = { ...fresh(), criticalMax: '2,49', opportunityMin: '2,50', opportunityMax: '4,24', strengthMin: '4,25' }
    expect(judgeBands(moved)).toEqual({ ok: true, opportunityMin: 2.5, strengthMin: 4.25 })
  })

  it('names a gap with the values either side of it — the canvas’s 2,99 → 3,10', () => {
    const verdict = judgeBands({ ...fresh(), opportunityMin: '3,10' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.problems).toEqual([{ kind: 'gap', from: 2.99, to: 3.1, fields: ['criticalMax', 'opportunityMin'] }])
    // The example the message names lies in the gap.
    const example = gapExample(2.99, 3.1)
    expect(example).toBeGreaterThan(2.99)
    expect(example).toBeLessThan(3.1)
  })

  it('names an overlap, where a mean would fall in two areas at once', () => {
    const verdict = judgeBands({ ...fresh(), opportunityMax: '4,10' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.problems).toEqual([{ kind: 'overlap', from: 4, to: 4.1, fields: ['opportunityMax', 'strengthMin'] }])
  })

  it('judges the seam in hundredths, so 2,99 → 3,00 is never a float’s hair apart', () => {
    // 0.1 + 0.2 style noise: 2.99 + 0.01 is 3.0000000000000004 in floating point.
    const verdict = judgeBands({ ...fresh(), criticalMax: '2,99', opportunityMin: '3' })
    expect(verdict.ok).toBe(true)
  })

  it('refuses an area that ends before it starts, and a box that is not a number', () => {
    const inverted = judgeBands({ ...fresh(), opportunityMin: '3,50', opportunityMax: '3,40', criticalMax: '3,49', strengthMin: '3,41' })
    expect(inverted.ok).toBe(false)
    if (!inverted.ok) expect(inverted.problems.some((problem) => problem.kind === 'inverted' && problem.band === 'opportunity')).toBe(true)
    const garbled = judgeBands({ ...fresh(), strengthMin: 'cuatro' })
    expect(garbled.ok).toBe(false)
    if (!garbled.ok) expect(garbled.problems).toContainEqual({ kind: 'invalid', field: 'strengthMin', text: 'cuatro' })
  })

  it('refuses a name longer than the API keeps', () => {
    const verdict = judgeBands({ ...fresh(), names: { ...fresh().names, critical: 'x'.repeat(61) } })
    expect(verdict.ok).toBe(false)
  })

  it('saves a name left as the product’s default as the default, so it still follows the reader’s language', () => {
    expect(bandsOut(fresh(), t)).toEqual(DEFAULT_RESULT_BANDS)
    const renamed = { ...fresh(), names: { ...fresh().names, critical: '  Zona roja ' } }
    expect(bandsOut(renamed, t)?.names).toEqual({ critical: 'Zona roja', opportunity: null, strength: null })
    // A box cleared to nothing is the default too.
    expect(bandsOut({ ...fresh(), names: { ...fresh().names, strength: '' } }, t)?.names.strength).toBeNull()
  })

  it('says whether the draft would change what the server holds', () => {
    expect(bandsChanged(DEFAULT_RESULT_BANDS, fresh(), t)).toBe(false)
    expect(bandsChanged(DEFAULT_RESULT_BANDS, { ...fresh(), criticalMax: '2,49', opportunityMin: '2,50' }, t)).toBe(true)
    expect(bandsChanged(DEFAULT_RESULT_BANDS, { ...fresh(), names: { ...fresh().names, strength: 'Fortaleza' } }, t)).toBe(true)
  })
})
