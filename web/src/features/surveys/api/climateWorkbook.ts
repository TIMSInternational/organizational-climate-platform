import { getToken } from '../../../auth/token'
import { authFetch } from '../../../api/authFetch'
import { createCompany } from '../../org-structure/api/companies'
import { updateCompanySettings } from '../../org-structure/api/companySettings'
import { createDepartment, listDepartments } from '../../org-structure/api/departments'
import { createDemographicField, updateDemographicField } from '../../org-structure/api/demographicFields'
import { submitIntakeRows, type IntakeRow } from '../../org-structure/api/intake'
import { listUsers } from '../../org-structure/api/users'
import type { ResultBandsWire } from '../../result-bands/api'
import { createSurvey, type CreateSurveyInput } from './surveyCreate'
import { updateSurveyDistribution } from './surveyDistribution'

/** `CredentialModes` on the API: what an import may mail. */
export type CredentialMode = 'shared' | 'per_survey'

export interface ClimateWorkbookPreview {
  companyId: string | null
  /**
   * The target company's credential mode, as the bulk import will act on it. `null` when the
   * company does not exist yet: the import creates it, and a new company is `shared` (the
   * entity default, `Company.Settings.CredentialMode`).
   */
  credentialMode?: CredentialMode | string | null
  surveyId: string | null
  surveyStatus: string | null
  errors: string[]
  existingPeople: { id: string; email: string; role: string }[]
  fields: { id: string | null; field: string; label: string; options: { value: string; label: string; labelInput?: Partial<Record<'en' | 'es', string>> | null }[] }[]
  content: {
    company: { name: string; emailDomain: string; industry: string; size: string; country: string; language: string; timezone: string; anonymous: boolean; resultBands: ResultBandsWire }
    title: string; description: string; startDate: string; endDate: string
    invitationSubject: string | null; invitationMessage: string | null
    questions: NonNullable<CreateSurveyInput['questions']>
    people: IntakeRow[]
  }
}

export type WorkbookStage = 'company' | 'fields' | 'survey' | 'people' | 'done'
export interface WorkbookProgress { stage: WorkbookStage; done: number; total: number }
export interface WorkbookResult { companyId: string; surveyId: string; total: number; created: number; reused: number; credentialsNotSent: string[]; credentialMode: CredentialMode }

/**
 * The mode the import will act on, or `null` when the preview names one this client does not
 * know -- which the apply refuses before writing anything. A missing company is `shared`.
 */
export function workbookCredentialMode(plan: Pick<ClimateWorkbookPreview, 'credentialMode'>): CredentialMode | null {
  const mode = plan.credentialMode ?? 'shared'
  return mode === 'shared' || mode === 'per_survey' ? mode : null
}

/**
 * The preview's refusal, as a translation key. Not `authFetch`: that sets a JSON content type,
 * and this body is a multipart file. The status is read BEFORE the body -- a 403 arrives with
 * no body at all, and parsing it first put `SyntaxError: Unexpected end of JSON input` on screen.
 * A 400 carries the server's own Spanish reason (which sheet, which cell) and is shown as is.
 */
async function previewFailure(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as { message?: unknown } | null
  if (response.status === 400) return new Error(typeof body?.message === 'string' && body.message ? body.message : 'climateWorkbook.errors.badRequest')
  if (response.status === 401) return new Error('climateWorkbook.errors.session')
  if (response.status === 403) return new Error('climateWorkbook.errors.forbidden')
  if (response.status === 413) return new Error('climateWorkbook.errors.tooLarge')
  if (response.status >= 500) return new Error('climateWorkbook.errors.server')
  return new Error('climateWorkbook.failed')
}

export async function previewClimateWorkbook(baseUrl: string, file: File): Promise<ClimateWorkbookPreview> {
  const form = new FormData(); form.append('file', file)
  const headers = new Headers(); const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let response: Response
  try { response = await fetch(`${baseUrl}/admin/climate-workbooks/preview`, { method: 'POST', headers, body: form }) }
  catch (cause) { throw new Error('climateWorkbook.errors.network', { cause }) }
  if (!response.ok) throw await previewFailure(response)
  try { return await response.json() as ClimateWorkbookPreview }
  catch (cause) { throw new Error('climateWorkbook.failed', { cause }) }
}

const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const chunks = <T,>(rows: T[], size: number): T[][] => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))

/** Uses the same authenticated resource APIs as the existing screens. Accounts are created
 * in 100-row batches; a retry previews the original file again and reuses committed records.
 * No password ever enters this client or browser storage.
 *
 * It leaves the survey a DRAFT and sends no invitation, as `scripts/import-climate-workbook.mjs`
 * does. Launching and inviting are the distribution screen's job: a run that stopped halfway
 * used to leave a LIVE survey with part of its roster, and a draft is something a re-run can
 * finish. What the import mails is decided by the company's credential mode:
 *   shared      each NEW account gets its generated username and password now;
 *   per_survey  nothing -- each person's key is minted and mailed per survey with the
 *               invitation, and the API refuses `withCredentials` for such a company. */
export async function applyClimateWorkbook(baseUrl: string, plan: ClimateWorkbookPreview, progress: (p: WorkbookProgress) => void): Promise<WorkbookResult> {
  if (plan.errors.length > 0) throw new Error(plan.errors.join('\n'))
  // Before any write: a mode this client cannot honour is refused while nothing exists yet.
  const credentialMode = workbookCredentialMode(plan)
  if (!credentialMode) throw new Error('climateWorkbook.errors.unknownMode')
  const withCredentials = credentialMode === 'shared'
  const content = plan.content
  progress({ stage: 'company', done: 0, total: 1 })
  const companyId = plan.companyId ?? (await createCompany(baseUrl, content.company)).id
  await updateCompanySettings(baseUrl, companyId, { language: content.company.language, timezone: content.company.timezone, anonymousSurveys: content.company.anonymous, resultBands: content.company.resultBands })
  const departments = await listDepartments(baseUrl, companyId)
  const departmentIds = new Map(departments.filter(d => d.isActive).map(d => [key(d.name), d.id]))
  for (const name of new Set(content.people.map(p => p.department).filter((v): v is string => Boolean(v)))) {
    if (!departmentIds.has(key(name))) departmentIds.set(key(name), (await createDepartment(baseUrl, { companyId, name, isActive: true })).id)
  }
  progress({ stage: 'fields', done: 0, total: plan.fields.length })
  for (const [i, field] of plan.fields.entries()) {
    const options = field.options.map(o => ({ value: o.value, label: o.labelInput ?? { [content.company.language]: o.label } }))
    if (field.id) await updateDemographicField(baseUrl, field.id, { options })
    else await createDemographicField(baseUrl, { companyId, field: field.field, label: { en: field.label, es: field.label }, type: 'select', options, required: false, order: i + 1 })
    progress({ stage: 'fields', done: i + 1, total: plan.fields.length })
  }
  progress({ stage: 'survey', done: 0, total: 1 })
  let surveyId = plan.surveyId
  if (!surveyId) {
    const survey = await createSurvey(baseUrl, {
      companyId, title: { [content.company.language]: content.title }, description: { [content.company.language]: content.description },
      // Preview resolves each wall-clock date using the workbook's timezone. Send the
      // same instants in UTC: Npgsql rejects nonzero offsets for timestamptz columns.
      type: 'periodic', language: content.company.language,
      startDate: new Date(content.startDate).toISOString(), endDate: new Date(content.endDate).toISOString(),
      questions: content.questions, targetAudienceCount: content.people.length,
      departmentIds: [...new Set(content.people.map(p => departmentIds.get(key(p.department ?? ''))).filter((v): v is string => Boolean(v)))],
      settings: { anonymous: content.company.anonymous, allowPartialResponses: true, showProgress: true, autoSave: true,
        // No invitation email: the credentials mail the import sends each person already
        // carries the sign-in button and "Tu organizacion te invita a responder una encuesta",
        // and the invitation mail's own button answers the survey WITHOUT signing in. Ruled
        // 2026-10-19; the reasoning is on `survey.Settings.NotificationSendInvitations = false`
        // in SurveyEndpoints' create path. Sent explicitly rather than omitted because this
        // import is the one path that used to turn it on.
        notificationSendInvitations: false, notificationSendReminders: false, invitationSendImmediately: true,
        invitationCustomSubject: content.invitationSubject, invitationCustomMessage: content.invitationMessage },
    })
    // The survey froze the company's mode when it was created. If it differs from the mode this
    // run was planned for, stop before anybody is imported: the draft has no people and no
    // responses, and a re-run previews the mismatch as an error instead of mailing the wrong thing.
    const frozen = (survey as { settings?: { credentialMode?: string | null } }).settings?.credentialMode
    if (frozen && frozen !== credentialMode) throw new Error('climateWorkbook.errors.modeChanged')
    surveyId = survey.id
  }
  await updateSurveyDistribution(baseUrl, surveyId, { accessType: 'tokenized', accessRules: { requireLogin: true, allowAnonymous: false, singleResponse: true } })
  const existing = new Map(plan.existingPeople.map(p => [key(p.email), p]))
  const newRows = content.people.filter(p => !existing.has(key(p.email)))
  const credentialsNotSent: string[] = []
  let created = 0
  progress({ stage: 'people', done: 0, total: content.people.length })
  // Validate ALL batches before sending the first credentials email.
  for (const batch of chunks(newRows, 100)) {
    const check = await submitIntakeRows(baseUrl, companyId, batch, true, [], withCredentials)
    if (check.errorCount > 0) throw new Error(check.rows.flatMap(r => r.errors).join('\n'))
  }
  for (const batch of chunks(newRows, 100)) {
    const result = await submitIntakeRows(baseUrl, companyId, batch, false, [], withCredentials)
    credentialsNotSent.push(...result.rows.filter(r => r.issues?.some(issue => issue.code === 'credentials_not_sent')).map(r => r.email))
    if (result.errorCount > 0) throw new Error(result.rows.flatMap(r => r.errors).join('\n'))
    created += result.successCount
    progress({ stage: 'people', done: created, total: content.people.length })
  }
  // Existing accounts keep their role/password. Merge demographics instead of clearing
  // fields omitted from this workbook, and only update users already scoped by the preview.
  let updated = 0
  for (const batch of chunks(content.people.filter(p => existing.has(key(p.email))), 4)) {
    await Promise.all(batch.map(async row => {
      const user = existing.get(key(row.email))!
      const detail = await (await authFetch(`${baseUrl}/admin/users/${user.id}`)).json() as { demographics: Record<string, string> }
      await authFetch(`${baseUrl}/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ name: row.name, departmentId: departmentIds.get(key(row.department ?? '')), demographics: { ...detail.demographics, ...row.demographics } }) })
    }))
    updated += batch.length
    progress({ stage: 'people', done: created + updated, total: content.people.length })
  }
  const users = await listUsers(baseUrl, companyId)
  const ids = new Map(users.map(u => [key(u.email), u.id]))
  const targetIds = content.people.map(p => ids.get(key(p.email)))
  if (targetIds.some(id => !id)) throw new Error('climateWorkbook.incompleteParticipants')
  // No status change and no invitation: the survey stays as it is (a draft, for a new one).
  progress({ stage: 'done', done: targetIds.length, total: targetIds.length })
  return { companyId, surveyId, total: targetIds.length, created, reused: existing.size, credentialsNotSent, credentialMode }
}

export async function downloadClimateWorkbook(baseUrl: string): Promise<Blob> {
  return (await authFetch(`${baseUrl}/admin/climate-workbooks/template`)).blob()
}
