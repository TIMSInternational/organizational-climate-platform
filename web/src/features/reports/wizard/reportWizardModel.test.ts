import { describe, expect, it } from 'vitest'
import { surveyReportFileName, surveyReportQuery, type SurveyReportOptions, type SurveyReportVariable } from '../api/surveyReport'
import {
  addCross,
  initialReportWizardState,
  reportWizardErrors,
  suggestedCrosses,
  toReportChoice,
  type ReportWizardState,
} from './reportWizardModel'

const VARIABLES: SurveyReportVariable[] = [
  { field: 'department', label: 'Departamento', valueCount: 8 },
  { field: 'gender', label: 'Género', valueCount: 3 },
  { field: 'tenure', label: 'Antigüedad', valueCount: 4 },
]

function state(over: Partial<ReportWizardState> = {}): ReportWizardState {
  return { ...initialReportWizardState('es'), surveyId: 's1', ...over }
}

describe('the report wizard model', () => {
  it('never asks for a comparison without a survey to compare with, nor for crosses without a cross', () => {
    const choice = toReportChoice(state())
    expect(choice.sections).not.toContain('comparison')
    expect(choice.sections).not.toContain('crosses')
    expect(choice.sections).toContain('summary')

    const full = toReportChoice(state({ compareSurveyId: 's0', crosses: [{ row: 'department', column: 'gender' }] }))
    expect(full.sections).toContain('comparison')
    expect(full.sections).toContain('crosses')
  })

  it('falls back to the summary when every section it kept was one the survey cannot fill', () => {
    expect(toReportChoice(state({ sections: ['comparison'] })).sections).toEqual(['summary'])
  })

  it('sends departments only when the scope is the chosen ones', () => {
    expect(toReportChoice(state({ departmentIds: ['d1'] })).departmentIds).toBeNull()
    expect(toReportChoice(state({ scope: 'chosen', departmentIds: ['d1'] })).departmentIds).toEqual(['d1'])
  })

  it('refuses a cross already listed, transposed or not, a variable crossed with itself, and a fifth one', () => {
    const one = addCross([], { row: 'department', column: 'gender' }, 4)
    expect(addCross(one, { row: 'gender', column: 'department' }, 4)).toBe(one)
    expect(addCross(one, { row: 'gender', column: 'gender' }, 4)).toBe(one)
    const full = [1, 2, 3, 4].map((i) => ({ row: `f${i}`, column: null }))
    expect(addCross(full, { row: 'department', column: 'gender' }, 4)).toBe(full)
    expect(addCross(one, { row: 'department', column: null }, 4)).toHaveLength(2)
  })

  it('suggests the department against each demographic, then two demographics, skipping what is listed', () => {
    expect(suggestedCrosses(VARIABLES, [])).toEqual([
      { row: 'department', column: 'gender' },
      { row: 'department', column: 'tenure' },
      { row: 'gender', column: 'tenure' },
    ])
    expect(suggestedCrosses(VARIABLES, [{ row: 'gender', column: 'department' }])).toEqual([
      { row: 'department', column: 'tenure' },
      { row: 'gender', column: 'tenure' },
    ])
  })

  it('names what each step still needs', () => {
    const loaded = {} as SurveyReportOptions
    expect(reportWizardErrors(initialReportWizardState('es'), null).survey).toEqual(['chooseSurvey'])
    expect(reportWizardErrors(state(), null).survey).toEqual(['loadingSurvey'])
    expect(reportWizardErrors(state({ scope: 'chosen', departmentIds: [] }), loaded).scope).toEqual(['chooseDepartment'])
    expect(reportWizardErrors(state({ sections: [] }), loaded).content).toEqual(['chooseSection'])
  })

  it('completes no later step before a survey is chosen and read', () => {
    const errors = reportWizardErrors(initialReportWizardState('es'), null)
    expect(errors.scope).toEqual(['chooseSurvey'])
    expect(errors.crosses).toEqual(['chooseSurvey'])
    expect(errors.content).toEqual(['chooseSurvey'])
    expect(errors.review).toEqual(['chooseSurvey'])
    expect(reportWizardErrors(state(), {} as SurveyReportOptions).crosses).toEqual([])
  })
})

describe('the report routes’ query', () => {
  it('carries the language, the sections, every department, every cross and the comparison', () => {
    const query = new URLSearchParams(
      surveyReportQuery({
        lang: 'es',
        sections: ['summary', 'crosses'],
        departmentIds: ['d1', 'd2'],
        crosses: [
          { row: 'department', column: 'gender' },
          { row: 'tenure', column: null },
        ],
        compareSurveyId: 's0',
      }),
    )
    expect(query.get('lang')).toBe('es')
    expect(query.get('sections')).toBe('summary,crosses')
    expect(query.getAll('department')).toEqual(['d1', 'd2'])
    expect(query.getAll('cross')).toEqual(['department*gender', 'tenure'])
    expect(query.get('compare')).toBe('s0')
  })

  it('names the file after the survey, as the server does', () => {
    expect(surveyReportFileName('Clima Organizacional 2026', 'es')).toBe('informe-clima-organizacional-2026.pdf')
    expect(surveyReportFileName('Pulso · Noviembre', 'en')).toBe('report-pulso-noviembre.pdf')
    expect(surveyReportFileName(null, 'es')).toBe('informe.pdf')
  })
})
