import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { listUsers, updateUser, updateUserRole, type User } from '../api/users'
import { listDepartments, type Department } from '../api/departments'
import { listInvitations, createInvitation, createShareableLink, resendInvitation, type Invitation } from '../api/invitations'
import UserList from '../components/UserList'
import UserFilters, { type UserFiltersValue } from '../components/UserFilters'
import UserForm, { type UserFormValues } from '../components/UserForm'
import InvitationList from '../components/InvitationList'
import InvitationForm, { type InvitationFormValues } from '../components/InvitationForm'
import ShareableLinkPanel from '../components/ShareableLinkPanel'
import BulkImportPanel from '../components/BulkImportPanel'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  SkeletonText,
} from '../../../components/ui'
import { UserPlus, Upload } from 'lucide-react'

/**
 * The roster, and the invite path (UI redesign).
 *
 * ## What changed and why
 *
 * The page used to be six components stacked with no hierarchy: filters, an edit
 * form, a table of five columns, two `<h2>`s and three panels, all always open.
 * The redesign makes the roster the page — one bordered table carrying role,
 * department, status and last activity — and puts the two ways a person can be
 * *added* behind the two header actions, because adding is an occasional act and
 * reading the roster is the constant one.
 *
 * Nothing about the data changed: the same four endpoints, the same
 * `updateUser`/`updateUserRole` sequencing, the same client-side name/email
 * filter. Departments are the one addition, and they are fetched separately on
 * purpose — see `reload` below.
 *
 * ## The count beside the search box
 *
 * `{shown} of {total}` is a reading, so it is set in mono with tabular figures.
 * It exists because the filter is client-side and silent: with no count, typing a
 * query that matches nothing looks identical to a company with no users.
 */
export default function UsersListPage() {
  const { t } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [users, setUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<UserFiltersValue>({ search: '' })
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [inviting, setInviting] = useState(false)
  const [importing, setImporting] = useState(false)

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

  // Departments are loaded apart from the roster, and a failure here is
  // swallowed rather than surfaced. They exist only to turn a `departmentId` into
  // a name in one column; `GET /admin/departments` is a different endpoint with
  // its own authorisation, and a page that showed "could not load users" because
  // the *department* list 403'd would be reporting a failure that did not happen.
  // A row whose department cannot be named falls back to "Unassigned", which is
  // what an unset `departmentId` already renders as.
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    listDepartments(baseUrl, companyId)
      .then((result) => {
        if (!cancelled) setDepartments(result)
      })
      .catch(() => {
        if (!cancelled) setDepartments([])
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, companyId])

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
      <PageTopBar
        eyebrow={t('navigation.companyAdministration')}
        title={t('navigation.users')}
        description={t('users.rosterDescription')}
        // /admin/companies/:id is loadable by a super_admin and by the
        // company_admin of that company, which is exactly who can reach this page
        // -- so this crumb never links somewhere the viewer would be 403'd. A
        // crumb to /admin/companies would, since that page is SuperAdmin-only.
        breadcrumbs={[
          { label: t('navigation.companySettings'), href: `/admin/companies/${companyId}` },
          { label: t('navigation.users') },
        ]}
        actions={
          <>
            <Button onClick={() => setImporting((open) => !open)}>
              <Upload aria-hidden="true" />
              {t('users.bulkImport')}
            </Button>
            {/* The primary action is *Invite*, not "Add user", because an
                invitation is the only way a person enters a company here: there
                is no create-user endpoint, and a button promising one would be a
                button that cannot keep its promise. */}
            <Button variant="primary" onClick={() => setInviting((open) => !open)}>
              <UserPlus aria-hidden="true" />
              {t('users.inviteUser')}
            </Button>
          </>
        }
      />

      {inviting && (
        <Card className="mb-panel-gap">
          <CardHeader>
            <CardTitle>{t('users.inviteUser')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="max-w-prose text-fg-secondary">{t('users.inviteDescription')}</p>
            <InvitationForm allowCompanyAdminSetup onSubmit={handleCreateInvitation} />
            <ShareableLinkPanel onCreate={handleCreateShareableLink} />
            <div className="mt-panel-gap">
              <Button variant="ghost" onClick={() => setInviting(false)}>
                {t('users.closeInvite')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {importing && companyId && (
        <Card className="mb-panel-gap">
          <CardHeader>
            <CardTitle>{t('users.bulkImport')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="max-w-prose text-fg-secondary">{t('users.bulkImportDescription')}</p>
            <BulkImportPanel baseUrl={baseUrl} companyId={companyId} onImported={reload} />
            <div className="mt-panel-gap">
              <Button variant="ghost" onClick={() => setImporting(false)}>
                {t('users.closeInvite')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {editingUser && (
        <Card className="mb-panel-gap">
          <CardHeader>
            <CardTitle>{t('users.editUser')}</CardTitle>
          </CardHeader>
          <CardContent>
            <UserForm key={editingUser.id} user={editingUser} canChangeRole onSubmit={handleUpdate} />
            <div className="mt-panel-gap">
              <Button variant="ghost" onClick={() => setEditingUser(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-panel-gap flex flex-wrap items-center justify-between gap-inline">
        <UserFilters value={filters} onChange={setFilters} />
        <span className="font-mono text-sm tabular-nums text-fg-secondary">
          {t('users.showingCount', { shown: filtered.length, total: users.length })}
        </span>
      </div>

      {loading ? (
        <SkeletonText lines={4} />
      ) : (
        <UserList users={filtered} departments={departments} onEdit={setEditingUser} />
      )}

      <section className="mt-section">
        <h2>{t('users.invitations')}</h2>
        <InvitationList invitations={invitations} onResend={handleResend} />
      </section>
    </div>
  )
}
