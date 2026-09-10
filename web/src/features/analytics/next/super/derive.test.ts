import { describe, expect, it } from 'vitest'
import type { SurveyListItem } from '../../../surveys/api/surveys'
import type { BenchmarkListItem } from '../../api/benchmarks'
import { cohortPhrase, globalBenchmarks, isUnscored, lastClosedSurvey } from './derive'
import { createTranslator } from '../../../../i18n/translate'
import es from '../../../../i18n/es.json'
import en from '../../../../i18n/en.json'

function survey(status: string, title: string, endDate: string, responseCount = 24): SurveyListItem {
  return {
    id: title,
    title,
    companyId: 'm',
    type: 'periodic',
    status,
    language: 'both',
    startDate: endDate,
    endDate,
    responseCount,
    targetAudienceCount: null,
    questionCount: 6,
    createdAt: endDate,
  }
}

describe('lastClosedSurvey', () => {
  it("is Meridiano's Q3, closed 6 Aug with 24 responses — not the open Q4 nor its archived copy", () => {
    const surveys = [
      survey('archived', 'Encuesta de Clima Q4 (abierta) (Copia)', '2026-10-10T02:03:39Z', 1),
      survey('closed', 'Encuesta de Clima Q2', '2026-05-13T02:03:12Z'),
      survey('active', 'Encuesta de Clima Q4 (abierta)', '2026-10-10T02:03:39Z', 3),
      survey('closed', 'Encuesta de Clima Q3', '2026-08-06T02:05:22Z'),
    ]
    expect(lastClosedSurvey(surveys)).toEqual({
      code: 'Q3',
      name: 'Encuesta de Clima Q3',
      endDate: '2026-08-06T02:05:22Z',
      responses: 24,
    })
  })

  it('is absent when nothing has closed', () => {
    expect(lastClosedSurvey([survey('active', 'Q1', '2026-10-10T00:00:00Z')])).toBeNull()
  })
})

describe('benchmarks', () => {
  const benchmark = (id: string, companyId: string | null, qualityScore: number): BenchmarkListItem => ({
    id,
    name: id,
    type: 'industry',
    category: 'climate',
    companyId,
    isActive: true,
    qualityScore,
    priorPeriodStatus: 'unlinked',
  })

  it('keeps the global ones only', () => {
    expect(globalBenchmarks([benchmark('g', null, 0), benchmark('own', 'm', 70)]).map((item) => item.id)).toEqual(['g'])
  })

  it('reads a zero quality score as unscored, as the triage ruled', () => {
    expect(isUnscored(benchmark('g', null, 0))).toBe(true)
    expect(isUnscored(benchmark('own', 'm', 72.5))).toBe(false)
  })
})

describe('cohortPhrase', () => {
  it('writes a cohort benchmark’s name as the canvas does inside a sentence, in either language', () => {
    expect(cohortPhrase('Manufactura · 500–1000 personas', createTranslator(es), 'es')).toBe('manufactura, de 500 a 1000 personas')
    expect(cohortPhrase('Manufacturing · 500–1000 staff', createTranslator(en), 'en')).toBe('manufacturing, 500 to 1000 staff')
  })

  it('returns a name of any other shape as it is, never guessing at it', () => {
    expect(cohortPhrase('Índice regional 2025', createTranslator(es), 'es')).toBe('Índice regional 2025')
  })
})
