import { describe, it, expect } from 'vitest'
import { createTranslator, CATALOGUES, FALLBACK_LOCALE } from '../../i18n'
import type { Locale } from '../../i18n'
import {
  INSIGHT_PRIORITIES,
  INSIGHT_TYPES,
  insightPriorityLabel,
  insightTypeLabel,
} from './insightVocabulary'

function translatorFor(locale: Locale) {
  return createTranslator(CATALOGUES[locale], CATALOGUES[FALLBACK_LOCALE])
}

const en = translatorFor('en')
const es = translatorFor('es')

describe('insight vocabulary', () => {
  /**
   * The defect (#282): the list printed `insight.type` and `insight.priority`
   * straight from the wire, so a Spanish reader saw "risk" and "high" in a row
   * whose Status column already said "Abierto".
   */
  it('translates every known type into Spanish', () => {
    expect(INSIGHT_TYPES.map((type) => insightTypeLabel(es, type))).toEqual([
      'Patrón',
      'Riesgo',
      'Recomendación',
      'Predicción',
    ])
  })

  it('translates every known priority into Spanish', () => {
    expect(INSIGHT_PRIORITIES.map((p) => insightPriorityLabel(es, p))).toEqual([
      'Baja',
      'Media',
      'Alta',
      'Crítica',
    ])
  })

  it('translates every known type and priority into English', () => {
    expect(INSIGHT_TYPES.map((type) => insightTypeLabel(en, type))).toEqual([
      'Pattern',
      'Risk',
      'Recommendation',
      'Prediction',
    ])
    expect(INSIGHT_PRIORITIES.map((p) => insightPriorityLabel(en, p))).toEqual([
      'Low',
      'Medium',
      'High',
      'Critical',
    ])
  })

  /**
   * The guard against the failure the previous "render the raw string" comment
   * was worried about. A `t()` miss returns the key path, so a catalogue typo
   * would put `insights.typeRisk` on screen; asserting the labels above against
   * the real catalogues is what makes that impossible.
   */
  it('never renders a raw catalogue key path', () => {
    const rendered = [
      ...INSIGHT_TYPES.map((type) => insightTypeLabel(es, type)),
      ...INSIGHT_PRIORITIES.map((p) => insightPriorityLabel(es, p)),
      ...INSIGHT_TYPES.map((type) => insightTypeLabel(en, type)),
      ...INSIGHT_PRIORITIES.map((p) => insightPriorityLabel(en, p)),
    ]
    for (const label of rendered) {
      expect(label).not.toMatch(/^(insights|actionPlans)\./)
    }
  })

  /**
   * `AIInsightValidation.ValidateCreate` bounds `Type` and `Priority` at
   * "non-empty, ≤ 20 characters" and nothing else — neither column has a CHECK —
   * so the wire can carry a value outside the legacy enum. AC #3: it falls back
   * to the raw string, never to blank and never to a key path.
   */
  it('falls back to the server value for a type it does not know', () => {
    expect(insightTypeLabel(es, 'anomaly')).toBe('anomaly')
    expect(insightTypeLabel(en, 'anomaly')).toBe('anomaly')
  })

  it('falls back to the server value for a priority it does not know', () => {
    expect(insightPriorityLabel(es, 'urgent')).toBe('urgent')
    expect(insightPriorityLabel(en, 'urgent')).toBe('urgent')
  })

  it('does not blank out an empty or oddly-cased value', () => {
    // Case matters: the enum is lowercase on the wire, and "Risk" is not "risk".
    // Rendering the server's own casing is honest; rendering nothing is not.
    expect(insightTypeLabel(es, 'Risk')).toBe('Risk')
    expect(insightPriorityLabel(es, 'HIGH')).toBe('HIGH')
    expect(insightTypeLabel(es, '')).toBe('')
  })

  /**
   * A `Record<string, string>` lookup is a prototype-chain hazard: `keys['toString']`
   * is a function, and a truthy non-string key would have been handed to `t()`.
   */
  it('does not resolve inherited object properties as labels', () => {
    expect(insightTypeLabel(es, 'toString')).toBe('toString')
    expect(insightPriorityLabel(es, 'constructor')).toBe('constructor')
  })
})
