import { describe, expect, it } from 'vitest'
import { exportBundleFallbackName, exportBundleQuery, fileNameFrom } from '../api/exportBundle'
import { exportWizardErrors, exportWizardSteps, filesFor, initialExportWizardState, toExportChoice } from './exportWizardModel'

describe('the download wizard model', () => {
  it('walks TIMS through the company first and a client straight to their surveys', () => {
    expect(exportWizardSteps(true)).toEqual(['company', 'surveys', 'files', 'details', 'download'])
    expect(exportWizardSteps(false)).toEqual(['surveys', 'files', 'details', 'download'])
  })

  it('offers the response workbook to TIMS alone', () => {
    expect(filesFor(true)).toContain('responses')
    expect(filesFor(false)).not.toContain('responses')
  })

  it('never sends the response workbook for a client, whatever the state holds', () => {
    const state = { ...initialExportWizardState('c1', false, 'es'), files: ['responses', 'results'] as const }
    expect(toExportChoice(state, false).files).toEqual(['results'])
    expect(toExportChoice(state, true).files).toEqual(['responses', 'results'])
  })

  it('downloads every survey unless some were chosen', () => {
    const state = initialExportWizardState('c1', false, 'es')
    expect(toExportChoice({ ...state, surveyIds: ['s1'] }, false).surveyIds).toEqual([])
    expect(toExportChoice({ ...state, surveyMode: 'chosen', surveyIds: ['s1'] }, false).surveyIds).toEqual(['s1'])
  })

  it('names what each step still needs', () => {
    const state = initialExportWizardState(null, true, 'es')
    expect(exportWizardErrors(state, null).company).toEqual(['chooseCompany'])
    expect(exportWizardErrors(state, null).surveys).toEqual(['chooseCompany'])
    expect(exportWizardErrors({ ...state, companyId: 'c1' }, 0).surveys).toEqual(['noSurveys'])
    expect(exportWizardErrors({ ...state, companyId: 'c1', surveyMode: 'chosen' }, 3).surveys).toEqual(['chooseSurvey'])
    expect(exportWizardErrors({ ...state, files: [] }, 3).files).toEqual(['chooseFile'])
  })
})

describe('the bundle route’s query and file name', () => {
  it('sends each file’s options only when that file is asked for', () => {
    const base = {
      surveyIds: ['s1', 's2'],
      groups: ['department', 'gender'],
      statusFormat: 'progress' as const,
      includeAnswers: false,
      lang: 'es' as const,
    }
    const both = new URLSearchParams(exportBundleQuery({ ...base, files: ['responses', 'status', 'results'] }))
    expect(both.getAll('survey')).toEqual(['s1', 's2'])
    expect(both.getAll('file')).toEqual(['responses', 'status', 'results'])
    expect(both.getAll('group')).toEqual(['department', 'gender'])
    expect(both.get('format')).toBe('progress')
    expect(both.get('answers')).toBe('false')

    const questionnaire = new URLSearchParams(exportBundleQuery({ ...base, files: ['questionnaire'] }))
    expect(questionnaire.getAll('group')).toEqual([])
    expect(questionnaire.get('format')).toBeNull()
    expect(questionnaire.get('answers')).toBeNull()
  })

  it('reads the name the server gave the file, preferring the encoded form', () => {
    expect(fileNameFrom("attachment; filename=descargas.zip; filename*=UTF-8''descargas-meridiano-2026-11-14.zip")).toBe(
      'descargas-meridiano-2026-11-14.zip',
    )
    expect(fileNameFrom('attachment; filename="estado.xlsx"')).toBe('estado.xlsx')
    expect(fileNameFrom(null)).toBeNull()
  })

  it('falls back to the server’s own naming when the header cannot be read', () => {
    const choice = { surveyIds: [], groups: [], statusFormat: 'standard' as const, includeAnswers: true, lang: 'es' as const }
    const day = new Date(2026, 10, 14)
    expect(exportBundleFallbackName({ ...choice, files: ['status', 'results'] }, 'Cooperativa Austral', day)).toBe(
      'descargas-cooperativa-austral-2026-11-14.zip',
    )
    expect(exportBundleFallbackName({ ...choice, files: ['questionnaire'] }, 'Cooperativa Austral', day)).toBe(
      'cuestionario-cooperativa-austral-2026-11-14.xlsx',
    )
  })
})
