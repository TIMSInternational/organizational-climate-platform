import { EXPORT_FILES, type ExportBundleChoice, type ExportFile } from '../api/exportBundle'

export type ExportWizardStep = 'company' | 'surveys' | 'files' | 'details' | 'download'

/** The steps a role walks: TIMS chooses the company first; a client's administrator starts at their own surveys. */
export function exportWizardSteps(isSuperAdmin: boolean): ExportWizardStep[] {
  return isSuperAdmin
    ? ['company', 'surveys', 'files', 'details', 'download']
    : ['surveys', 'files', 'details', 'download']
}

/** The files a role may download. The response workbook is TIMS's alone (ruled 2026-10-16). */
export function filesFor(isSuperAdmin: boolean): ExportFile[] {
  return EXPORT_FILES.filter((file) => isSuperAdmin || file !== 'responses')
}

export interface ExportWizardState {
  companyId: string | null
  /** `all` downloads every distributed survey, including any distributed after the page opened. */
  surveyMode: 'all' | 'chosen'
  surveyIds: readonly string[]
  files: readonly ExportFile[]
  groups: readonly string[]
  statusFormat: 'standard' | 'progress'
  includeAnswers: boolean
  lang: 'es' | 'en'
}

export function initialExportWizardState(companyId: string | null, isSuperAdmin: boolean, lang: 'es' | 'en'): ExportWizardState {
  return {
    companyId,
    surveyMode: 'all',
    surveyIds: [],
    files: filesFor(isSuperAdmin),
    groups: ['department'],
    statusFormat: 'standard',
    includeAnswers: true,
    lang,
  }
}

/** Error keys per step (`exportWizard.errors.*`). */
export function exportWizardErrors(state: ExportWizardState, distributedCount: number | null): Record<ExportWizardStep, string[]> {
  const surveys: string[] = []
  // The surveys are a company's: until TIMS picks one there is nothing to pick from, and the
  // rail must not call the later steps complete.
  if (!state.companyId) surveys.push('chooseCompany')
  else if (distributedCount === 0) surveys.push('noSurveys')
  else if (state.surveyMode === 'chosen' && state.surveyIds.length === 0) surveys.push('chooseSurvey')
  return {
    company: state.companyId ? [] : ['chooseCompany'],
    surveys,
    files: state.files.length === 0 ? ['chooseFile'] : [],
    details: [],
    download: [],
  }
}

export function toExportChoice(state: ExportWizardState, isSuperAdmin: boolean): ExportBundleChoice {
  const allowed = filesFor(isSuperAdmin)
  return {
    surveyIds: state.surveyMode === 'chosen' ? state.surveyIds : [],
    // Never sends a file the role may not have, whatever the state holds.
    files: EXPORT_FILES.filter((file) => state.files.includes(file) && allowed.includes(file)),
    groups: state.groups,
    statusFormat: state.statusFormat,
    includeAnswers: state.includeAnswers,
    lang: state.lang,
  }
}
