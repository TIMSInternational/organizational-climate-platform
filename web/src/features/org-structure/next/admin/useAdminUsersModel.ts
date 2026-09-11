import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../../../i18n'
import { useCompanyName } from '../../../../company-context/useCompanyName'
import { listDepartments, type Department } from '../../api/departments'
import { listInvitations, type Invitation } from '../../api/invitations'
import { listUsers, type User } from '../../api/users'

export interface AdminUsersState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** The tenant's name off the viewer's own `/profile` (cached by the shell); `null` until read. */
  companyName: string | null
  users: readonly User[]
  /**
   * `null` when `GET /admin/departments` failed: a department is then unnamed rather than
   * mis-named, and the tile that counts departments prints a dash, never a zero.
   */
  departments: readonly Department[] | null
  /** `null` when `GET /admin/invitations` failed, so nothing says "none pending" about a list never read. */
  invitations: readonly Invitation[] | null
  error: string | null
  reload: () => void
}

async function optional<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    const value = await work()
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/**
 * THE wiring seam of the company administrator's *Usuarios* (`UsersList` artboard): the
 * three reads the old `UsersListPage` made, and nothing else — `GET /admin/users?companyId=`
 * (the roster, which the page cannot do without), and `GET /admin/departments?companyId=`
 * and `GET /admin/invitations?companyId=`, each of which fails on its own. The tenant's name
 * comes from `useCompanyName()` (`GET /profile`): `GET /admin/companies/{id}` answers only a
 * super administrator (`CompanyEndpoints.cs:29`), so this role never asks it.
 *
 * `enabled` is the viewer's capability: a caller the server would refuse
 * (`UserEndpoints.cs:47`, `CanAccessCompany`) sends nothing at all.
 */
export function useAdminUsersModel(companyId: string | undefined, enabled: boolean): AdminUsersState {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyName = useCompanyName()
  const [status, setStatus] = useState<AdminUsersState['status']>(enabled ? 'loading' : 'idle')
  const [users, setUsers] = useState<readonly User[]>([])
  const [departments, setDepartments] = useState<readonly Department[] | null>(null)
  const [invitations, setInvitations] = useState<readonly Invitation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!companyId || !enabled) return
    let cancelled = false
    async function load(id: string) {
      setStatus('loading')
      setError(null)
      try {
        const [roster, units, invites] = await Promise.all([
          listUsers(baseUrl, id),
          optional(() => listDepartments(baseUrl, id)),
          optional(() => listInvitations(baseUrl, id)),
        ])
        if (cancelled) return
        setUsers(roster)
        setDepartments(units)
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
  }, [baseUrl, companyId, enabled, attempt, t])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return { status, companyName, users, departments, invitations, error, reload }
}
