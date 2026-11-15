import type {
  SurveyReportChoice,
  SurveyReportCross,
  SurveyReportOptions,
  SurveyReportSection,
  SurveyReportVariable,
} from '../api/surveyReport'

/** The wizard's five steps, in order. */
export const REPORT_WIZARD_STEPS = ['survey', 'scope', 'crosses', 'content', 'review'] as const
export type ReportWizardStep = (typeof REPORT_WIZARD_STEPS)[number]

/** What the person has chosen so far. */
export interface ReportWizardState {
  surveyId: string | null
  lang: 'es' | 'en'
  compareSurveyId: string | null
  scope: 'all' | 'chosen'
  /** Ticked departments, used only when `scope === 'chosen'`. */
  departmentIds: readonly string[]
  crosses: readonly SurveyReportCross[]
  sections: readonly SurveyReportSection[]
}

export function initialReportWizardState(lang: 'es' | 'en'): ReportWizardState {
  return {
    surveyId: null,
    lang,
    compareSurveyId: null,
    scope: 'all',
    departmentIds: [],
    crosses: [],
    sections: ['summary', 'dimensions', 'map', 'comparison', 'crosses', 'questions', 'highlights'],
  }
}

/** Error keys per step (`reportWizard.errors.*`); a step with none is complete. */
export function reportWizardErrors(state: ReportWizardState, options: SurveyReportOptions | null): Record<ReportWizardStep, string[]> {
  const surveyErrors: string[] = []
  if (!state.surveyId) surveyErrors.push('chooseSurvey')
  else if (!options) surveyErrors.push('loadingSurvey')

  // Every later step belongs to the survey -- its departments, its variables -- so none of
  // them is complete before one is chosen and read. Without this the rail called four empty
  // steps «Completo» on a page where nothing had been chosen yet (screenshot, 14 Nov 2026).
  if (surveyErrors.length > 0) {
    return { survey: surveyErrors, scope: ['chooseSurvey'], crosses: ['chooseSurvey'], content: ['chooseSurvey'], review: ['chooseSurvey'] }
  }

  const scopeErrors: string[] = []
  if (state.scope === 'chosen' && state.departmentIds.length === 0) scopeErrors.push('chooseDepartment')

  const contentErrors: string[] = []
  if (state.sections.length === 0) contentErrors.push('chooseSection')

  return { survey: surveyErrors, scope: scopeErrors, crosses: [], content: contentErrors, review: [] }
}

/**
 * The choice the routes read. Sections the survey cannot fill are dropped here rather than
 * sent: «Comparación» with nothing to compare with, «Cruces» with no cross.
 */
export function toReportChoice(state: ReportWizardState): SurveyReportChoice {
  const sections = state.sections.filter(
    (section) =>
      (section !== 'comparison' || state.compareSurveyId !== null) && (section !== 'crosses' || state.crosses.length > 0),
  )
  return {
    lang: state.lang,
    // A report with every section a survey cannot fill dropped still needs one section; the
    // summary is the one every report has.
    sections: sections.length > 0 ? sections : ['summary'],
    departmentIds: state.scope === 'chosen' ? state.departmentIds : null,
    crosses: state.crosses,
    compareSurveyId: state.compareSurveyId,
  }
}

export function sameCross(a: SurveyReportCross, b: SurveyReportCross): boolean {
  return (a.row === b.row && a.column === b.column) || (a.column !== null && a.row === b.column && a.column === b.row)
}

/** Adds a cross unless it is already listed, transposed or not, or the list is full. */
export function addCross(
  crosses: readonly SurveyReportCross[],
  cross: SurveyReportCross,
  max: number,
): readonly SurveyReportCross[] {
  if (cross.row === cross.column) return crosses
  if (crosses.length >= max || crosses.some((existing) => sameCross(existing, cross))) return crosses
  return [...crosses, cross]
}

/**
 * Up to three crosses to offer as one tap: the department against each demographic, then the
 * first two demographics against each other -- the combinations a climate report usually
 * carries -- skipping any already listed.
 */
export function suggestedCrosses(
  variables: readonly SurveyReportVariable[],
  listed: readonly SurveyReportCross[],
): SurveyReportCross[] {
  const department = variables.find((variable) => variable.field === 'department')
  const demographics = variables.filter((variable) => variable.field !== 'department')
  const candidates: SurveyReportCross[] = []
  if (department) for (const demographic of demographics) candidates.push({ row: 'department', column: demographic.field })
  if (demographics.length >= 2) candidates.push({ row: demographics[0].field, column: demographics[1].field })
  return candidates.filter((candidate) => !listed.some((existing) => sameCross(existing, candidate))).slice(0, 3)
}

/** The variable's label, or its key when the survey does not carry it. */
export function variableLabel(variables: readonly SurveyReportVariable[], field: string): string {
  return variables.find((variable) => variable.field === field)?.label ?? field
}

/** Ticks or unticks one value in a list, keeping the list's order. */
export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}
