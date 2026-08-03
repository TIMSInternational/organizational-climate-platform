import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listUsers, updateUser, updateUserRole, type User } from '../api/users'
import { listInvitations, createInvitation, createShareableLink, resendInvitation, type Invitation } from '../api/invitations'
import UserList from '../components/UserList'
import UserFilters, { type UserFiltersValue } from '../components/UserFilters'
import UserForm, { type UserFormValues } from '../components/UserForm'
import InvitationList from '../components/InvitationList'
import InvitationForm, { type InvitationFormValues } from '../components/InvitationForm'
import ShareableLinkPanel from '../components/ShareableLinkPanel'
import BulkImportPanel from '../components/BulkImportPanel'
import { useTranslation } from '../../../i18n'

export default function UsersListPage() {
  const { t } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<UserFiltersValue>({ search: '' })
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])

  async function reload() {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const [usersResult, invitationsResult] = await Promise.all([
        listUsers(baseUrl, companyId),
        listInvitations(baseUrl, companyId),
      ])
      setUsers(usersResult)
      setInvitations(invitationsResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [companyId])

  const filtered = users.filter((user) => {
    const search = filters.search.toLowerCase()
    if (!search) return true
    return user.name.toLowerCase().includes(search) || user.email.toLowerCase().includes(search)
  })

  async function handleUpdate(values: UserFormValues) {
    if (!editingUser) return
    // updateUser and updateUserRole are two separate backend calls with no server-side
    // transaction between them (role changes are intentionally SuperAdmin-only and
    // stricter, per Global Constraints). If updateUser succeeds but updateUserRole then
    // fails (e.g. a CompanyAdmin gets a 403), the profile change is already persisted.
    // Always reload() -- even on failure -- so the table reflects whatever the server
    // actually committed instead of showing stale pre-edit values, and only clear
    // editingUser (closing the form) once both calls have actually succeeded so the
    // admin can see the error and retry the remaining change.
    try {
      await updateUser(baseUrl, editingUser.id, { name: values.name, isActive: values.isActive })
      if (values.role !== editingUser.role) {
        await updateUserRole(baseUrl, editingUser.id, values.role)
      }
      setEditingUser(null)
    } finally {
      await reload()
    }
  }

  async function handleCreateInvitation(values: InvitationFormValues) {
    if (!companyId) return
    await createInvitation(baseUrl, {
      invitationType: values.invitationType,
      email: values.email,
      companyId,
      role: values.role,
    })
    await reload()
  }

  async function handleCreateShareableLink(role: string): Promise<Invitation> {
    if (!companyId) throw new Error('Missing companyId')
    const invitation = await createShareableLink(baseUrl, { companyId, role })
    await reload()
    return invitation
  }

  async function handleResend(invitation: Invitation) {
    await resendInvitation(baseUrl, invitation.id)
    await reload()
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <h1>{t('navigation.users')}</h1>
      <UserFilters value={filters} onChange={setFilters} />
      {editingUser && (
        <UserForm key={editingUser.id} user={editingUser} canChangeRole onSubmit={handleUpdate} />
      )}
      {loading ? <p>{t('common.loading')}</p> : <UserList users={filtered} onEdit={setEditingUser} />}
      <h2>{t('users.invitations')}</h2>
      <InvitationForm allowCompanyAdminSetup onSubmit={handleCreateInvitation} />
      <ShareableLinkPanel onCreate={handleCreateShareableLink} />
      <InvitationList invitations={invitations} onResend={handleResend} />
      <h2>{t('users.bulkImport')}</h2>
      {companyId && <BulkImportPanel baseUrl={baseUrl} companyId={companyId} onImported={reload} />}
    </div>
  )
}
