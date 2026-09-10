import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sampleWave } from './sampleModel'
import es from '../../../i18n/es.json'
import type { SurveyAnalyticsResponse } from '../api/surveyResults'

/**
 * The shot fixture the results-next screen is rendered against (`web/docs/screenshots.md`).
 * Read from disk the way `employeeCopy.test.ts` reads the respond fixture: the file is
 * outside `src`, so it is not importable under `tsconfig.app.json`'s `include`.
 */
const FIXTURE = join(process.cwd(), 'scripts', 'shot-fixtures', 'survey-results-next.json')

/**
 * `sampleWave.dimensionDeltas` is looked up by the map's dimension key, which is the
 * question's `category` verbatim (`surveyResultsMap.ts` `dimensionKeyOf`). A key the
 * product never writes is a delta no survey can ever draw — and the view prints "no Q2"
 * for it, so nothing in a green suite says the cell was missing. The product's words
 * are the keys of `surveyRespond.dimensions`, which `dimensionLabel.ts` reads.
 */
describe('sampleWave', () => {
  it('keys every per-dimension delta on a slug the product writes', () => {
    const slugs = Object.keys(es.surveyRespond.dimensions)
    const keys = Object.keys(sampleWave.dimensionDeltas)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(slugs, `sample delta key "${key}" is not a product slug`).toContain(key)
  })

  it('is exercised by the shot fixture: its scale questions carry the slugs the sample knows', () => {
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, SurveyAnalyticsResponse>
    const scale = fixture['GET /surveys/*/analytics'].questions.filter((q) => q.type === 'likert' || q.type === 'rating')
    // A fixture with no scale question would make the sweep below pass on nothing.
    expect(scale.length).toBeGreaterThan(0)
    for (const question of scale) {
      expect(Object.keys(sampleWave.dimensionDeltas), `fixture question ${question.questionId}`).toContain(question.category)
    }
  })
})
