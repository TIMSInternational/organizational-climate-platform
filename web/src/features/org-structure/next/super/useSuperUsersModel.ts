import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { getCompany, type CompanyDetail } from '../../api/companies'
import { listDepartments, type Department } from '../../api/departments'
import { listInvitations, type Invitation } from '../../api/invitations'
import { listUsers, type User } from '../../api/users'

export interface SuperUsersState {
  status: 'loading' | 'ready' | 'error'
  /** `null` until read, or when the read failed: the breadcrumb then names no tenant. */
  company: CompanyDetail | null
  users: readonly User[]
  /** `[]` when the read failed — a department is then unnamed, never mis-named. */
  departments: readonly Department[]
  /** `null` when the read failed, so the card cannot say "none pending" about a list it never saw. */
  invitations: readonly Invitation[] | null
  error: string | null
  reload: () => void
}

async function optional<T>(work: () => Promise<T>, accept: (value: unknown) => boolean): Promise<T | null> {
  try {
    const value = await work()
    return accept(value) ? value : null
  } catch {
    return null
  }
}

const isList = (value: unknown) => Array.isArray(value)

/**
 * THE wiring seam of the super administrator's roster: the four reads `UsersListPage`
 * makes — `GET /admin/users?companyId=`, `GET /admin/invitations?companyId=`,
 * `GET /admin/departments?companyId=` — plus `GET /admin/companies/{id}` for the tenant's
 * name in the breadcrumb, which this role (and only this role) may read. The roster is the
 * page; the other three fail on their own, as the old page's departments already did.
 */
export function useSuperUsersModel(companyId: string | undefined): SuperUsersState {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [status, setStatus] = useState<SuperUsersState['status']>('loading')
  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [users, setUsers] = useState<readonly User[]>([])
  const [departments, setDepartments] = useState<readonly Department[]>([])
  const [invitations, setInvitations] = useState<readonly Invitation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    async function load(id: string) {
      setStatus('loading')
      setError(null)
      try {
        const [roster, tenant, units, invites] = await Promise.all([
          listUsers(baseUrl, id),
          optional(() => getCompany(baseUrl, id), (value) => typeof value === 'object' && value !== null && 'name' in value),
          optional(() => listDepartments(baseUrl, id), isList),
          optional(() => listInvitations(baseUrl, id), isList),
        ])
        if (cancelled) return
        setUsers(roster)
        setCompany(tenant)
        setDepartments(units ?? [])
        setInvitations(invites)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('errors.generic'))
        setStatus('error')
      }
    }
    void load(companyId)
    return () => {
      cancelled = true
    }
  }, [companyId, baseUrl, t, attempt])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  return { status, company, users, departments, invitations, error, reload }
}
