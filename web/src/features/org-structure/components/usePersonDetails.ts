import { useEffect, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { getUser, type UpdateUserInput, type User } from '../api/users'
import { listDemographicFields, type DemographicField } from '../api/demographicFields'

/**
 * The part of a person the roster does not carry: who they report to and their demographic
 * answers (audit G6). `PUT /admin/users/{id}` has always accepted both; no screen sent either.
 *
 * Read from `GET /admin/users/{id}` (the roster's list item has no manager and no demographics)
 * and the company's demographic fields. A failed read leaves both untouched on save rather than
 * sending blanks: a blank manager or answer IS an instruction to clear it.
 */
export interface PersonDetailsState {
  status: 'loading' | 'ready' | 'error'
  /** From the user detail: a per-survey-code person, whom the password reset refuses. */
  surveyCodesOnly: boolean
  managerId: string
  setManagerId: (id: string) => void
  fields: readonly DemographicField[]
  answers: Readonly<Record<string, string>>
  setAnswer: (field: string, value: string) => void
  /** The part of an update this state adds, or null when nothing here changed. */
  changes: () => { input: Partial<UpdateUserInput>; missing: string | null; invalid: string | null }
}

/** Active fields, in the company's order: a retired field cannot be answered (the API refuses it). */
function activeFields(fields: readonly DemographicField[]): DemographicField[] {
  return fields.filter((field) => field.isActive).sort((a, b) => a.order - b.order)
}

export function usePersonDetails(baseUrl: string, user: User, companyId: string | undefined): PersonDetailsState {
  const { locale } = useTranslation()
  const [status, setStatus] = useState<PersonDetailsState['status']>('loading')
  const [originalManager, setOriginalManager] = useState('')
  const [managerId, setManagerId] = useState('')
  const [fields, setFields] = useState<DemographicField[]>([])
  const [original, setOriginal] = useState<Record<string, string>>({})
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [surveyCodesOnly, setSurveyCodesOnly] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all([getUser(baseUrl, user.id), companyId ? listDemographicFields(baseUrl, companyId, locale) : Promise.resolve([])])
      .then(([detail, defined]) => {
        if (!live) return
        const manager = detail.managerId ?? ''
        const stored = detail.demographics ?? {}
        setSurveyCodesOnly(detail.surveyCodesOnly === true)
        setOriginalManager(manager)
        setManagerId(manager)
        setFields(activeFields(defined))
        setOriginal(stored)
        setAnswers(stored)
        setStatus('ready')
      })
      .catch(() => {
        if (live) setStatus('error')
      })
    return () => {
      live = false
    }
  }, [baseUrl, user.id, companyId, locale])

  return {
    status,
    surveyCodesOnly,
    managerId,
    setManagerId,
    fields,
    answers,
    setAnswer: (field, value) => setAnswers((current) => ({ ...current, [field]: value })),
    changes: () => {
      const input: Partial<UpdateUserInput> = {}
      if (status !== 'ready') return { input, missing: null, invalid: null }
      if (managerId !== originalManager) {
        if (managerId) input.managerId = managerId
        else input.clearManager = true
      }
      const edited = fields.some((field) => (answers[field.field] ?? '').trim() !== (original[field.field] ?? '').trim())
      if (!edited) return { input, missing: null, invalid: null }
      // The API REPLACES the set, so this is every active answer, edited or not; a blank one is
      // left out, which clears it.
      const map: Record<string, string> = {}
      for (const field of fields) {
        const value = (answers[field.field] ?? '').trim()
        if (value) map[field.field] = value
      }
      const missing = fields.find((field) => field.required && !map[field.field])
      const invalid = fields.find((field) => field.type === 'number' && map[field.field] && !Number.isFinite(Number(map[field.field])))
      input.demographics = map
      return { input, missing: missing ? (missing.label ?? missing.field) : null, invalid: invalid ? (invalid.label ?? invalid.field) : null }
    },
  }
}

/**
 * Builds the update a panel sends from what changed in it: the department (now removable), and
 * the manager and demographics above. Only what changed is sent, so an ordinary save carries
 * neither a manager nor a demographic map and cannot be refused for an answer it did not touch.
 */
export function departmentChange(user: User, departmentId: string): Partial<UpdateUserInput> {
  if (departmentId === (user.departmentId ?? '')) return {}
  return departmentId ? { departmentId } : { clearDepartment: true }
}
