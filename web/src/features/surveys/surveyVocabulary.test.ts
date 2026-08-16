import { describe, it, expect } from 'vitest'
import { SUGGESTED_DIMENSION_KEYS, needsScaleLabels } from './surveyVocabulary'
import { dimensionLabel } from './dimensionLabel'
import { CATALOGUES, LOCALES } from '../../i18n/locale'
import { createTranslator, type MessageNode } from '../../i18n/translate'

/**
 * The picker's suggested vocabulary and the catalogue it claims to mirror.
 *
 * `SUGGESTED_DIMENSION_KEYS` is a hand-written copy of the keys under
 * `surveyRespond.dimensions`, because the constant's docstring says so — a copy
 * that can drift in either direction. A key here that the catalogue lost would
 * offer a chip whose label falls back to underscore-opening (fine for an author's
 * own text, a bug for the shipped vocabulary); a catalogue key missing here would
 * be a dimension the product can name but the picker never suggests, quietly
 * pushing authors into free text and splintering the vocabulary the suggestions
 * exist to converge.
 */
describe('SUGGESTED_DIMENSION_KEYS', () => {
  it('resolves every suggested key through every catalogue, via the function the pages call', () => {
    for (const locale of LOCALES) {
      const t = createTranslator(CATALOGUES[locale])
      for (const key of SUGGESTED_DIMENSION_KEYS) {
        const label = dimensionLabel(key, t)
        // `createTranslator` answers a miss with the key path; `dimensionLabel`
        // would then hand back the underscore-opened key. Neither is a catalogue name.
        expect(label, `${locale} cannot name ${key}`).not.toBe(
          `surveyRespond.dimensions.${key}`,
        )
        expect(label, `${locale} fell back for ${key}`).not.toBe(key.replace(/_+/g, ' '))
      }
    }
  })

  it('suggests every dimension the catalogue can name', () => {
    const dimensions = (CATALOGUES.en as Record<string, MessageNode>).surveyRespond as Record<
      string,
      MessageNode
    >
    const catalogued = Object.keys(dimensions.dimensions as Record<string, MessageNode>)
    expect([...SUGGESTED_DIMENSION_KEYS].sort()).toEqual(catalogued.sort())
  })
})

describe('needsScaleLabels', () => {
  it('is exactly the two scale-rendered types', () => {
    expect(needsScaleLabels('likert')).toBe(true)
    expect(needsScaleLabels('rating')).toBe(true)
    expect(needsScaleLabels('multiple_choice')).toBe(false)
    expect(needsScaleLabels('open_ended')).toBe(false)
    expect(needsScaleLabels('yes_no')).toBe(false)
    expect(needsScaleLabels('ranking')).toBe(false)
  })
})
