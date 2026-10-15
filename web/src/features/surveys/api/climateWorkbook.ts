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
import { updateSurveyStatus } from './surveys'
import { createSurveyInvitations, updateSurveyDistribution } from './surveyDistribution'

export interface ClimateWorkbookPreview {
  companyId: string | null
  surveyId: string | null
  surveyStatus: string | null
  errors: string[]
  existingPeople: { id: string; email: string; role: string }[]
  fields: { id: string | null; field: string; label: string; options: { value: string; label: string; labelEn?: string | null; labelEs?: string | null }[] }[]
  content: {
    company: { name: string; emailDomain: string; industry: string; size: string; country: string; language: string; timezone: string; anonymous: boolean; resultBands: ResultBandsWire }
    title: string; description: string; startDate: string; endDate: string
    invitationSubject: string | null; invitationMessage: string | null
    questions: NonNullable<CreateSurveyInput['questions']>
    people: IntakeRow[]
  }
}

export type WorkbookStage = 'company' | 'fields' | 'survey' | 'people' | 'invitations' | 'done'
export interface WorkbookProgress { stage: WorkbookStage; done: number; total: number }
export interface WorkbookResult { companyId: string; surveyId: string; total: number; created: number; reused: number; credentialsNotSent: string[] }

export async function previewClimateWorkbook(baseUrl: string, file: File): Promise<ClimateWorkbookPreview> {
  const form = new FormData(); form.append('file', file)
  const headers = new Headers(); const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${baseUrl}/admin/climate-workbooks/preview`, { method: 'POST', headers, body: form })
  const body = await response.json()
  if (!response.ok) throw new Error(body?.message ?? 'climateWorkbook.failed')
  return body as ClimateWorkbookPreview
}

const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const chunks = <T,>(rows: T[], size: number): T[][] => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size))

/** Uses the same authenticated resource APIs as the existing screens. Accounts are created
 * in 100-row batches; a retry previews the original file again and reuses committed records.
 * No password ever enters this client or browser storage. */
export async function applyClimateWorkbook(baseUrl: string, plan: ClimateWorkbookPreview, progress: (p: WorkbookProgress) => void): Promise<WorkbookResult> {
  if (plan.errors.length > 0) throw new Error(plan.errors.join('\n'))
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
    const options = field.options.map(o => ({ value: o.value, label: { en: o.labelEn ?? o.label, es: o.labelEs ?? o.label } }))
    if (field.id) await updateDemographicField(baseUrl, field.id, { options })
    else await createDemographicField(baseUrl, { companyId, field: field.field, label: { en: field.label, es: field.label }, type: 'select', options, required: false, order: i + 1 })
    progress({ stage: 'fields', done: i + 1, total: plan.fields.length })
  }
  progress({ stage: 'survey', done: 0, total: 1 })
  const surveyId = plan.surveyId ?? (await createSurvey(baseUrl, {
    companyId, title: { [content.company.language]: content.title }, description: { [content.company.language]: content.description },
    type: 'periodic', language: content.company.language, startDate: content.startDate, endDate: content.endDate,
    questions: content.questions, targetAudienceCount: content.people.length,
    departmentIds: [...new Set(content.people.map(p => departmentIds.get(key(p.department ?? ''))).filter((v): v is string => Boolean(v)))],
    settings: { anonymous: content.company.anonymous, allowPartialResponses: true, showProgress: true, autoSave: true,
      notificationSendInvitations: true, notificationSendReminders: false, invitationSendImmediately: true,
      invitationCustomSubject: content.invitationSubject, invitationCustomMessage: content.invitationMessage },
  })).id
  await updateSurveyDistribution(baseUrl, surveyId, { accessType: 'tokenized', accessRules: { requireLogin: true, allowAnonymous: false, singleResponse: true } })
  if (!plan.surveyStatus || plan.surveyStatus === 'draft') await updateSurveyStatus(baseUrl, surveyId, Date.parse(content.startDate) > Date.now() ? 'scheduled' : 'active')
  const existing = new Map(plan.existingPeople.map(p => [key(p.email), p]))
  const newRows = content.people.filter(p => !existing.has(key(p.email)))
  const credentialsNotSent: string[] = []
  let created = 0
  progress({ stage: 'people', done: 0, total: content.people.length })
  // Validate ALL batches before sending the first credentials email.
  for (const batch of chunks(newRows, 100)) {
    const check = await submitIntakeRows(baseUrl, companyId, batch, true, [], true)
    if (check.errorCount > 0) throw new Error(check.rows.flatMap(r => r.errors).join('\n'))
  }
  for (const batch of chunks(newRows, 100)) {
    const result = await submitIntakeRows(baseUrl, companyId, batch, false, [], true)
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
  let invited = 0
  for (const batch of chunks(targetIds as string[], 100)) {
    progress({ stage: 'invitations', done: invited, total: targetIds.length })
    await createSurveyInvitations(baseUrl, surveyId, { userIds: batch })
    invited += batch.length
  }
  progress({ stage: 'done', done: targetIds.length, total: targetIds.length })
  return { companyId, surveyId, total: targetIds.length, created, reused: existing.size, credentialsNotSent }
}

export async function downloadClimateWorkbook(baseUrl: string): Promise<Blob> {
  return (await authFetch(`${baseUrl}/admin/climate-workbooks/template`)).blob()
}
