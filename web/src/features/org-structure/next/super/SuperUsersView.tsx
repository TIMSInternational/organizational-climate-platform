import { useId, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { ArrowRight, Check, Link2, Mail, Search, Shield, Upload, UserPlus } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { ANONYMITY_FLOOR } from '../../../../components/charts'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  EmptyState,
  Input,
  LoadingRegion,
  NetworkError,
  SkeletonText,
  Switch,
  Table,
} from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { createInvitation, createShareableLink, resendInvitation, type Invitation } from '../../api/invitations'
import { updateUser, updateUserRole, type User } from '../../api/users'
import type { Department } from '../../api/departments'
import BulkImportPanel from '../../components/BulkImportPanel'
import InvitationForm, { type InvitationFormValues } from '../../components/InvitationForm'
import InvitationList from '../../components/InvitationList'
import ShareableLinkPanel from '../../components/ShareableLinkPanel'
import { roleText } from './labels'
import { Field, Panel } from './parts'
import {
  ROLE_ORDER,
  VISIBLE_ROWS,
  filterPeople,
  initialsOf,
  neverSignedIn,
  orderPeople,
  pendingInvitations,
  roleCounts,
} from './superUsers'
import { useSuperUsersModel } from './useSuperUsersModel'

const TH =
  'border-b border-line-default bg-transparent px-3 pb-2 pt-1 text-2xs font-bold uppercase tracking-label whitespace-nowrap text-fg-tertiary'

const FACET_KEY: Readonly<Record<string, string>> = {
  super_admin: 'superadmin.next.users.roleSuperAdmin',
  company_admin: 'superadmin.next.users.roleCompanyAdmin',
  leader: 'superadmin.next.users.roleLeader',
  supervisor: 'superadmin.next.users.roleSupervisor',
  employee: 'superadmin.next.users.roleEmployee',
}

type OpenPanel = 'none' | 'invite' | 'import'

/**
 * `/admin/companies/:companyId/users` for a super administrator — the canvas's *Usuarios
 * (tenant abierto)* (`SuperUsersList` artboard). `UsersListPage` dispatches here for this
 * role and keeps drawing the company administrator's page otherwise.
 *
 * The same roster, the same four reads and the same writes as the old page —
 * `updateUser` then `updateUserRole`, in that order, and a reload whatever happened — with
 * the tenant named in the breadcrumb, the roster ordered by role and name, facets per
 * role, a department filter, and the two ways in (an invitation, a bulk import) surfaced
 * as cards the triage asked for instead of living only behind the header's buttons.
 *
 * `canAssignRoles` is what puts the role select in the edit panel: `PUT
 * /admin/users/{id}/role` refuses every caller but a super administrator, who may assign
 * any of the five roles, company administrator included.
 */
/** The query parameter that opens the edit panel on one person: `?editar=<userId>`. */
export const EDIT_PARAM = 'editar'

/**
 * The row action stays in view while the columns scroll under it below `xl` (1280), as on
 * Empresas; from `xl` up every column fits and the cell is ordinary.
 */
const STICKY_ACTION = 'sticky right-0 z-[1] bg-surface-card border-l border-line-light xl:static xl:border-l-0 xl:bg-transparent'

export default function SuperUsersView() {
  const { t } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const capabilities = useViewerCapabilities()
  const state = useSuperUsersModel(companyId)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [role, setRole] = useState('')
  const [department, setDepartment] = useState('')
  const [search, setSearch] = useState('')
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState<OpenPanel>('none')
  const [expanded, setExpanded] = useState(false)
  const searchId = useId()

  const companyName = state.company?.name ?? null
  const ordered = orderPeople(state.users)
  const visible = filterPeople(ordered, role, department, search)
  const shown = expanded ? visible : visible.slice(0, VISIBLE_ROWS)
  const counts = roleCounts(state.users)
  const departmentName = new Map(state.departments.map((unit) => [unit.id, unit.name]))
  // `?editar=<id>` names the person in the edit panel. An id that is not in this tenant's
  // roster opens nothing.
  const editingId = params.get(EDIT_PARAM)
  const editing = editingId ? (state.users.find((user) => user.id === editingId) ?? null) : null
  const setEditing = (user: User | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (user) next.set(EDIT_PARAM, user.id)
        else next.delete(EDIT_PARAM)
        return next
      },
      { replace: true },
    )

  async function handleCreateInvitation(values: InvitationFormValues) {
    if (!companyId) return
    await createInvitation(baseUrl, { invitationType: values.invitationType, email: values.email, companyId, role: values.role })
    state.reload()
  }

  async function handleCreateShareableLink(linkRole: string): Promise<Invitation> {
    // `companyId` is the route's; the page only renders under it.
    const invitation = await createShareableLink(baseUrl, { companyId: companyId ?? '', role: linkRole })
    state.reload()
    return invitation
  }

  async function handleResend(invitation: Invitation) {
    await resendInvitation(baseUrl, invitation.id)
    state.reload()
  }

  const breadcrumbs = [
    { label: t('navigation.companies'), href: '/admin/companies' },
    ...(companyName ? [{ label: companyName, href: `/admin/companies/${companyId}` }] : []),
    { label: t('navigation.users') },
  ]

  return (
    <div className="flex flex-col gap-section">
      <div className="-mb-2">
        <PageTopBar
          eyebrow={companyName ?? t('navigation.systemAdministration')}
          title={t('navigation.users')}
          description={t('superadmin.next.users.description')}
          breadcrumbs={breadcrumbs}
          actions={
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(open === 'import' ? 'none' : 'import')}>
                <Upload aria-hidden="true" />
                {t('superadmin.next.users.bulkImport')}
              </Button>
              <Button type="button" variant="primary" onClick={() => setOpen(open === 'invite' ? 'none' : 'invite')}>
                <UserPlus aria-hidden="true" />
                {t('superadmin.next.users.invite')}
              </Button>
            </>
          }
        />
      </div>

      {open === 'invite' && companyId && (
        <Panel
          accent
          labelledBy="users-invite"
          heading={
            <h2 id="users-invite" className="m-0 text-2xl">
              {t('superadmin.next.users.invite')}
            </h2>
          }
        >
          <p className="m-0 max-w-measure text-xs text-fg-secondary">{t('superadmin.next.users.invitations.text')}</p>
          <InvitationForm allowCompanyAdminSetup onSubmit={handleCreateInvitation} />
          <ShareableLinkPanel onCreate={handleCreateShareableLink} />
          <div>
            <Button type="button" variant="ghost" onClick={() => setOpen('none')}>
              {t('superadmin.next.users.invitations.close')}
            </Button>
          </div>
        </Panel>
      )}

      {open === 'import' && companyId && (
        <Panel
          accent
          labelledBy="users-import"
          heading={
            <h2 id="users-import" className="m-0 text-2xl">
              {t('superadmin.next.users.import.heading')}
            </h2>
          }
          meta={t('superadmin.next.users.import.meta')}
        >
          <BulkImportPanel baseUrl={baseUrl} companyId={companyId} onImported={state.reload} />
          <div>
            <Button type="button" variant="ghost" onClick={() => setOpen('none')}>
              {t('superadmin.next.users.invitations.close')}
            </Button>
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <div role="group" aria-label={t('superadmin.next.users.filterLabel')} className="flex w-full flex-wrap gap-1.5 xl:w-auto">
          {['', ...ROLE_ORDER.filter((facet) => (counts.get(facet) ?? 0) > 0)].map((facet) => {
            const selected = role === facet
            return (
              <Button
                key={facet || 'all'}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={selected}
                onClick={() => setRole(facet)}
                className={cn(
                  'h-5.5 rounded-lg px-2 text-xs font-medium',
                  selected
                    ? 'border-accent-red-ring bg-accent-red-soft text-accent-red hover:not-disabled:bg-accent-red-soft'
                    : 'border-line-default bg-surface-icon-box text-fg-secondary',
                )}
              >
                {facet === ''
                  ? t('superadmin.next.users.roleAll', { count: state.users.length })
                  : t(FACET_KEY[facet], { count: counts.get(facet) ?? 0 })}
              </Button>
            )
          })}
        </div>
        <label className="m-0 xl:ml-auto">
          <span className="sr-only">{t('superadmin.next.users.departmentFilterLabel')}</span>
          <select className="w-52" value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="">{t('superadmin.next.users.allDepartments')}</option>
            {state.departments.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={searchId} className="relative m-0 min-w-0 flex-1 sm:w-60 sm:flex-none">
          <span className="sr-only">{t('superadmin.next.users.searchPlaceholder')}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-tertiary" />
          <Input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('superadmin.next.users.searchPlaceholder')}
            className="w-full pl-8"
          />
        </label>
        <span className="whitespace-nowrap font-mono text-xs tabular-nums text-fg-tertiary">
          {t('superadmin.next.users.shown', { shown: visible.length, total: state.users.length })}
        </span>
      </div>

      {editing && (
        <EditPerson
          key={editing.id}
          user={editing}
          departments={state.departments}
          canAssignRoles={capabilities.canAssignRoles}
          onClose={() => setEditing(null)}
          onReload={state.reload}
        />
      )}

      {state.status === 'error' ? (
        <NetworkError
          title={t('superadmin.next.users.loadFailed')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' ? (
            <SkeletonText lines={6} />
          ) : visible.length === 0 ? (
            <EmptyState title={t('superadmin.next.users.empty')} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-line-default bg-surface-card pt-2 shadow-sm">
              {/* The table's minimum sits on a div for the reason the Empresas list gives. */}
              <div className="overflow-x-auto">
              {/* The Table primitive wraps its <table> in its own overflow-x-auto container; left as a scroller it
                  becomes the sticky Editar/Abrir cell's containing box, 70rem wide and never scrolled, so the cell
                  never pins. Visible here, the scroller above is the one it pins to. */}
              <div className="min-w-[56rem] [&_[data-slot=table-container]]:overflow-visible">
              <Table
                aria-label={t('superadmin.next.users.tableLabel', { company: companyName ?? '' })}
                className="table-fixed"
              >
                <colgroup>
                  <col />
                  <col className="w-56" />
                  <col className="w-36" />
                  <col className="w-24" />
                  <col className="w-32" />
                  <col className="w-24" />
                </colgroup>
                <thead>
                  <tr>
                    <th className={TH}>{t('superadmin.next.users.colPerson')}</th>
                    <th className={TH}>{t('superadmin.next.users.colRole')}</th>
                    <th className={TH}>{t('superadmin.next.users.colDepartment')}</th>
                    <th className={TH}>{t('superadmin.next.users.colStatus')}</th>
                    <th className={TH}>{t('superadmin.next.users.colLastActivity')}</th>
                    <th className={cn(TH, STICKY_ACTION)}>
                      <span className="sr-only">{t('common.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((user) => (
                    <PersonRow
                      key={user.id}
                      user={user}
                      department={user.departmentId ? (departmentName.get(user.departmentId) ?? null) : null}
                      selected={editing?.id === user.id}
                      onEdit={() => setEditing(user)}
                    />
                  ))}
                </tbody>
              </Table>
              </div>
              </div>
              <RosterFooter
                visible={visible}
                shownCount={shown.length}
                expanded={expanded}
                onToggle={() => setExpanded((value) => !value)}
              />
            </div>
          )}
        </LoadingRegion>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <InvitationsCard invitations={state.invitations} onInvite={() => setOpen('invite')} onResend={handleResend} />
        <Panel
          labelledBy="users-import-card"
          heading={
            <h2 id="users-import-card" className="m-0 text-2xl">
              {t('superadmin.next.users.import.heading')}
            </h2>
          }
          meta={t('superadmin.next.users.import.meta')}
        >
          <p className="m-0 text-xs text-fg-secondary">{t('superadmin.next.users.import.text')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen('import')}>
              <Upload aria-hidden="true" />
              {t('superadmin.next.users.import.choose')}
            </Button>
            <span className="text-xs text-fg-tertiary">{t('superadmin.next.users.import.format')}</span>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Avatar({ name, strong = false }: { name: string; strong?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-2xs font-semibold',
        strong ? 'bg-surface-shell text-fg-on-accent' : 'border border-line-default bg-surface-icon-box text-fg-secondary',
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

function PersonRow({
  user,
  department,
  selected,
  onEdit,
}: {
  user: User
  department: string | null
  selected: boolean
  onEdit: () => void
}) {
  const { t, locale } = useTranslation()
  return (
    <tr data-user-id={user.id} data-role={user.role} className={cn(selected && 'bg-surface-icon-box')}>
      <td className="px-3 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={user.name} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-fg-primary">{user.name}</span>
            <span className="truncate font-mono text-2xs text-fg-tertiary">{user.email}</span>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <Chip
          tone="neutral"
          icon={user.role === 'company_admin' || user.role === 'super_admin' ? <Shield className="size-3" /> : undefined}
          label={roleText(t, user.role)}
        />
      </td>
      <td className={cn('truncate px-3 py-3', department ? 'text-fg-secondary' : 'text-fg-tertiary')}>
        {department ?? t('superadmin.next.users.noDepartment')}
      </td>
      <td className="px-3 py-3">
        {user.isActive ? (
          <Chip tone="good" label={t('superadmin.next.users.statusActive')} />
        ) : (
          <Chip tone="neutral" label={t('superadmin.next.users.statusInactive')} />
        )}
      </td>
      <td className="px-3 py-3">
        {user.lastLoginAt ? (
          <span className="font-mono text-xs tabular-nums text-fg-primary">{calendarDay(Date.parse(user.lastLoginAt), locale)}</span>
        ) : (
          <span className="text-xs text-accent-amber-ink">{t('superadmin.next.users.neverSignedIn')}</span>
        )}
      </td>
      <td className={cn('px-3 py-3 text-right', STICKY_ACTION)}>
        <Button
          type="button"
          variant="outline"
          aria-label={t('superadmin.next.users.editNamed', { name: user.name })}
          onClick={onEdit}
        >
          {t('superadmin.next.users.edit')}
        </Button>
      </td>
    </tr>
  )
}

function RosterFooter({
  visible,
  shownCount,
  expanded,
  onToggle,
}: {
  visible: readonly User[]
  shownCount: number
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const hidden = visible.length - shownCount
  const never = neverSignedIn(visible)
  const parts = [
    hidden === 1
      ? t('superadmin.next.users.moreOne')
      : hidden > 1
        ? t('superadmin.next.users.moreMany', { count: hidden })
        : null,
    never.never > 0
      ? never.leaders > 0
        ? t('superadmin.next.users.neverStatsLeaders', { never: never.never, total: visible.length, leaders: never.leaders })
        : t('superadmin.next.users.neverStats', { never: never.never, total: visible.length })
      : null,
  ].filter(Boolean)

  if (parts.length === 0 && !expanded) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-xs text-fg-tertiary">
      <span>{parts.join(' ')}</span>
      {(hidden > 0 || expanded) && (
        <Button type="button" variant="link" onClick={onToggle} className="text-xs text-fg-secondary">
          {expanded ? t('superadmin.next.users.showFewer') : t('superadmin.next.users.showAll')}
          <ArrowRight aria-hidden="true" className="size-3" />
        </Button>
      )}
    </div>
  )
}

function EditPerson({
  user,
  departments,
  canAssignRoles,
  onClose,
  onReload,
}: {
  user: User
  departments: readonly Department[]
  canAssignRoles: boolean
  onClose: () => void
  onReload: () => void
}) {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [name, setName] = useState(user.name)
  const [role, setRole] = useState(user.role)
  const [departmentId, setDepartmentId] = useState(user.departmentId ?? '')
  const [isActive, setIsActive] = useState(user.isActive)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { name: useId(), email: useId(), role: useId(), department: useId(), active: useId() }
  // The API can move a person to a department but not out of one (`UpdateUserRequest`
  // carries a department only when set), so "none" is offered only to someone who has none.
  const options = departments.filter((unit) => unit.isActive || unit.id === user.departmentId)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      // Same sequence as `UsersListPage.handleUpdate`: the profile, then the role — two
      // requests with no transaction between them, so the roster reloads whatever happened.
      await updateUser(baseUrl, user.id, {
        name: name.trim(),
        isActive,
        ...(departmentId && departmentId !== user.departmentId ? { departmentId } : {}),
      })
      if (canAssignRoles && role !== user.role) await updateUserRole(baseUrl, user.id, role)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('superadmin.next.users.saveFailed'))
    } finally {
      setSaving(false)
      onReload()
    }
  }

  return (
    <Panel
      accent
      labelledBy="users-edit"
      heading={
        <div className="flex items-center gap-2.5">
          <Avatar name={user.name} strong />
          <h2 id="users-edit" className="m-0 text-2xl">
            {t('superadmin.next.users.editTitle', { name: user.name })}
          </h2>
        </div>
      }
      meta={t('superadmin.next.users.editMeta')}
      className="gap-3.5"
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {t('superadmin.next.users.saveFailed')}: {error}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
        <Field fieldLabel={t('superadmin.next.users.name')} htmlFor={ids.name}>
          <Input id={ids.name} value={name} onChange={(event) => setName(event.target.value)} className="w-full" />
        </Field>
        <Field fieldLabel={t('superadmin.next.users.email')} htmlFor={ids.email} helper={t('superadmin.next.users.emailHelper')}>
          <div className="flex h-control-lg items-center gap-2 rounded-md border border-line-default bg-surface-icon-box px-2.5">
            <Mail aria-hidden="true" className="size-3.5 shrink-0 text-fg-tertiary" />
            <input
              id={ids.email}
              readOnly
              value={user.email}
              className="h-auto w-full min-w-0 border-0 bg-transparent p-0 font-mono text-fg-primary"
            />
          </div>
        </Field>
        <Field
          fieldLabel={t('superadmin.next.users.role')}
          htmlFor={ids.role}
          helper={canAssignRoles ? t('superadmin.next.users.roleHelper') : undefined}
        >
          <select id={ids.role} className="w-full" value={role} disabled={!canAssignRoles} onChange={(event) => setRole(event.target.value)}>
            {ROLE_ORDER.map((option) => (
              <option key={option} value={option}>
                {roleText(t, option)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          fieldLabel={t('superadmin.next.users.department')}
          htmlFor={ids.department}
          helper={t('superadmin.next.users.departmentHelper', { floor: ANONYMITY_FLOOR })}
        >
          <select id={ids.department} className="w-full" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            {!user.departmentId && <option value="">{t('superadmin.next.users.noDepartment')}</option>}
            {options.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-light pt-2.5">
        <label htmlFor={ids.active} className="m-0 inline-flex items-center gap-2 text-xs text-fg-secondary">
          <Switch id={ids.active} checked={isActive} onCheckedChange={setIsActive} className="data-[state=checked]:bg-accent-green" />
          <span>
            {t('superadmin.next.users.activeLabel')} · {t('superadmin.next.users.activeHelper')}
          </span>
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="outline" onClick={() => void save()} disabled={saving || !name.trim()}>
            <Check aria-hidden="true" />
            {t('superadmin.next.users.save')}
          </Button>
        </div>
      </div>
    </Panel>
  )
}

function InvitationsCard({
  invitations,
  onInvite,
  onResend,
}: {
  invitations: readonly Invitation[] | null
  onInvite: () => void
  onResend: (invitation: Invitation) => Promise<void>
}) {
  const { t } = useTranslation()
  const pending = invitations ? pendingInvitations(invitations) : null
  return (
    <Panel
      labelledBy="users-invitations"
      heading={
        <h2 id="users-invitations" className="m-0 text-2xl">
          {t('superadmin.next.users.invitations.heading')}
        </h2>
      }
      meta={
        pending === null
          ? t('superadmin.next.unavailable')
          : pending === 0
            ? t('superadmin.next.users.invitations.noneMeta')
            : pending === 1
              ? t('superadmin.next.users.invitations.pendingOne')
              : t('superadmin.next.users.invitations.pendingMany', { count: pending })
      }
    >
      <p className="m-0 text-xs text-fg-secondary">{t('superadmin.next.users.invitations.text')}</p>
      {invitations && invitations.length > 0 && <InvitationList invitations={[...invitations]} onResend={onResend} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={onInvite}>
          <Mail aria-hidden="true" />
          {t('superadmin.next.users.invitations.byEmail')}
        </Button>
        <Button type="button" variant="outline" onClick={onInvite}>
          <Link2 aria-hidden="true" />
          {t('superadmin.next.users.invitations.link')}
        </Button>
      </div>
    </Panel>
  )
}
