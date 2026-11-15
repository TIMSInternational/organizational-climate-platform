import { authFetch } from '../../../api/authFetch'

/**
 * The «Generar informe» wizard's three routes (`SurveyReportEndpoints.cs`):
 * `GET /surveys/{id}/report/options`, `GET /surveys/{id}/report/preview` and
 * `GET /surveys/{id}/export/report` (the PDF, audited as an export).
 */

/** A section of the report, in the order the PDF prints them (`SurveyReportSections`). */
export type SurveyReportSection =
  | 'summary'
  | 'dimensions'
  | 'map'
  | 'comparison'
  | 'crosses'
  | 'questions'
  | 'highlights'
  | 'comments'

export interface SurveyReportVariable {
  /** `department`, or a demographic field key. */
  field: string
  label: string
  valueCount: number
}

export interface SurveyReportDepartmentOption {
  id: string
  name: string | null
  respondentCount: number
  headcount: number | null
}

export interface SurveyReportComparableSurvey {
  id: string
  title: string | null
  status: string
  endDate: string | null
}

export interface SurveyReportOptions {
  surveyId: string
  title: string | null
  status: string
  resolvedLocale: string
  isSuppressed: boolean
  completedCount: number
  invitedCount: number | null
  departments: SurveyReportDepartmentOption[]
  variables: SurveyReportVariable[]
  comparableSurveys: SurveyReportComparableSurvey[]
  sections: SurveyReportSection[]
  defaultSections: SurveyReportSection[]
  maxCrosses: number
  scale: 'mean' | 'percent'
}

export interface SurveyReportCrossPreview {
  rowField: string
  columnField: string | null
  rowName: string
  columnName: string | null
  rows: number
  columns: number
  groups: number
  disclosed: number
  protected: number
}

export interface SurveyReportPreview {
  pageCount: number
  disclosedCells: number
  protectedCells: number
  departmentCount: number
  omittedDepartmentCount: number
  crosses: SurveyReportCrossPreview[]
}

/** One cross: a row variable, crossed with a column variable or alone (`null`). */
export interface SurveyReportCross {
  row: string
  column: string | null
}

/** What the wizard has chosen, as the routes read it. */
export interface SurveyReportChoice {
  lang: 'es' | 'en'
  sections: readonly SurveyReportSection[]
  /** `null` for every department. */
  departmentIds: readonly string[] | null
  crosses: readonly SurveyReportCross[]
  compareSurveyId: string | null
}

/** The query string the preview and the PDF share, so the two always describe one document. */
export function surveyReportQuery(choice: SurveyReportChoice): string {
  const query = new URLSearchParams()
  query.set('lang', choice.lang)
  query.set('sections', choice.sections.join(','))
  for (const id of choice.departmentIds ?? []) query.append('department', id)
  for (const cross of choice.crosses) query.append('cross', cross.column ? `${cross.row}*${cross.column}` : cross.row)
  if (choice.compareSurveyId) query.set('compare', choice.compareSurveyId)
  return query.toString()
}

export async function getSurveyReportOptions(baseUrl: string, surveyId: string, lang: string): Promise<SurveyReportOptions> {
  const response = await authFetch(`${baseUrl}/surveys/${encodeURIComponent(surveyId)}/report/options?lang=${encodeURIComponent(lang)}`)
  return response.json() as Promise<SurveyReportOptions>
}

export async function getSurveyReportPreview(
  baseUrl: string,
  surveyId: string,
  choice: SurveyReportChoice,
  signal?: AbortSignal,
): Promise<SurveyReportPreview> {
  const response = await authFetch(
    `${baseUrl}/surveys/${encodeURIComponent(surveyId)}/report/preview?${surveyReportQuery(choice)}`,
    { signal },
  )
  return response.json() as Promise<SurveyReportPreview>
}

/** The PDF. A fetch and a Blob, never an `<a href>`: an anchor sends cookies, not the bearer. */
export async function getSurveyReportPdf(baseUrl: string, surveyId: string, choice: SurveyReportChoice): Promise<Blob> {
  const response = await authFetch(`${baseUrl}/surveys/${encodeURIComponent(surveyId)}/export/report?${surveyReportQuery(choice)}`)
  if (!(response.headers.get('content-type') ?? '').includes('application/pdf')) throw new Error('not a pdf')
  return response.blob()
}

/** The download name, matching `SurveyReportEndpoints.FileName`: «informe-clima-organizacional-2026.pdf». */
export function surveyReportFileName(title: string | null, lang: 'es' | 'en'): string {
  const prefix = lang === 'es' ? 'informe' : 'report'
  const slug = (title ?? '')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return slug ? `${prefix}-${slug}.pdf` : `${prefix}.pdf`
}
