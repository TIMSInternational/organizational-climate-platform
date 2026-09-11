import { useId, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowRight, Check, Info, Link2, Lock, Mail, Search, Shield, Upload, UserPlus } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { KpiTile } from '../../../../components/charts'
import {
  Alert,
  AlertDescription,
  Button,
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
import { countWord } from '../../../../lib/countWord'
import { createInvitation, createShareableLink, resendInvitation, type Invitation } from '../../api/invitations'
import { updateUser, type User } from '../../api/users'
import type { Department } from '../../api/departments'
import BulkImportPanel from '../../components/BulkImportPanel'
import InvitationForm, { type InvitationFormValues } from '../../components/InvitationForm'
import ShareableLinkPanel from '../../components/ShareableLinkPanel'
import { roleText } from '../super/labels'
import { CanvasChip, CanvasSelect, Field, IconBox, MiniBar, Note, Panel } from '../super/parts'
import { initialsOf, orderPeople } from '../super/superUsers'
import {
  ALL_PEOPLE,
  NO_DEPARTMENT,
  departmentGroups,
  hasSignedIn,
  inGroup,
  isAdminRole,
  matchesSearch,
  pendingRows,
  rosterTally,
  type DepartmentGroup,
} from './adminUsers'
import { useAdminUsersModel } from './useAdminUsersModel'

const TH =
  'border-b border-line-default bg-transparent px-3 pb-2 pt-1 text-2xs font-bold uppercase tracking-label whitespace-nowrap text-fg-tertiary'
const EYEBROW = 'm-0 text-2xs font-bold uppercase tracking-label text-fg-tertiary'

/** The query parameters: `?departamento=<id|none>` filters the roster, `?editar=<userId>` opens a person. */
export const GROUP_PARAM = 'departamento'
export const EDIT_PARAM = 'editar'

type OpenPanel = 'none' | 'invite' | 'import'

/**
 * `/admin/companies/:companyId/users` for a company administrator — the canvas's *Usuarios*
 * (`UsersList` artboard, 10 Sep). `UsersNextPage` dispatches here for every role but the
 * super administrator, who has `SuperUsersView`.
 *
 * The triage asked for the roster grouped by department, deactivated people as a chip, the
 * two ways in as actions and pending invitations as a section: four tiles, a department
 * rail that filters the table, the edit panel above the table, and the invitations with
 * "how someone gets in" underneath. Same reads as the old page (`useAdminUsersModel`), and
 * the same writes — `updateUser`, invitations, shareable link, resend, bulk import.
 *
 * What this role may not do is not offered: `PUT /admin/users/{id}/role` refuses everyone but
 * a super administrator (`UserEndpoints.cs:284`), so the role is shown locked; deactivating an
 * administrator is super-only (`:147-149`), so that switch is locked too; and a company
 * administrator cannot mint a company-admin setup invitation (`InvitationEndpoints.cs:58-66`),
 * so the invitation form never offers one.
 */
export default function AdminUsersView() {
  const { t, locale } = useTranslation()
  const { companyId } = useParams<{ companyId: string }>()
  const capabilities = useViewerCapabilities()
  const allowed = capabilities.canManageOrg
  const state = useAdminUsersModel(companyId, allowed)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<OpenPanel>('none')
  const searchId = useId()

  const setParam = (name: string, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) next.set(name, value)
        else next.delete(name)
        return next
      },
      { replace: true },
    )

  const companyName = state.companyName
  const tally = rosterTally(state.users, state.departments)
  const groups = departmentGroups(state.users, state.departments, locale)
  const requested = params.get(GROUP_PARAM) ?? ALL_PEOPLE
  const selectedGroup = groups.find((entry) => entry.id === requested) ?? null
  const groupId = selectedGroup ? selectedGroup.id : ALL_PEOPLE
  const inSelection = orderPeople(state.users.filter((user) => inGroup(user, groupId)))
  const visible = inSelection.filter((user) => matchesSearch(user, search))
  const editingId = params.get(EDIT_PARAM)
  const editing = editingId ? (state.users.find((user) => user.id === editingId) ?? null) : null

  async function handleCreateInvitation(values: InvitationFormValues) {
    if (!companyId) return
    await createInvitation(baseUrl, { invitationType: values.invitationType, email: values.email, companyId, role: values.role })
    state.reload()
  }

  async function handleCreateShareableLink(linkRole: string): Promise<Invitation> {
    const invitation = await createShareableLink(baseUrl, { companyId: companyId ?? '', role: linkRole })
    state.reload()
    return invitation
  }

  async function handleResend(invitation: Invitation) {
    await resendInvitation(baseUrl, invitation.id)
    state.reload()
  }

  // The UsersList board sets the breadcrumb 14px over the header (its glyphs at y=76, the
  // eyebrow's at y=110 at 1440), not the 38px of the other admin boards: `tightBreadcrumb`.
  const header = (
    <div className="-mb-6">
      <PageTopBar
        eyebrow={companyName ?? t('navigation.companyAdministration')}
        title={t('navigation.users')}
        tightBreadcrumb
        description={t('users.next.description')}
        breadcrumbs={[
          { label: t('navigation.companyAdministration'), href: `/admin/companies/${companyId}` },
          { label: t('navigation.users') },
        ]}
        actions={
          allowed ? (
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(open === 'import' ? 'none' : 'import')}>
                <Upload aria-hidden="true" />
                {t('users.next.bulkImport')}
              </Button>
              <Button type="button" variant="primary" onClick={() => setOpen(open === 'invite' ? 'none' : 'invite')}>
                <UserPlus aria-hidden="true" />
                {t('users.next.invite')}
              </Button>
            </>
          ) : undefined
        }
      />
    </div>
  )

  if (!allowed) {
    return (
      <div className="flex flex-col gap-section">
        {header}
        <EmptyState title={t('users.next.forbidden')} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-section">
      {header}

      {open === 'invite' && companyId && (
        <Panel
          accent
          labelledBy="users-invite"
          heading={
            <h2 id="users-invite" className="m-0 text-2xl">
              {t('users.next.invite')}
            </h2>
          }
          meta={t('users.next.panel.inviteMeta')}
        >
          <InvitationForm allowCompanyAdminSetup={capabilities.canAssignRoles} onSubmit={handleCreateInvitation} />
          <ShareableLinkPanel onCreate={handleCreateShareableLink} />
          <div>
            <Button type="button" variant="ghost" onClick={() => setOpen('none')}>
              {t('users.next.panel.close')}
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
              {t('users.next.bulkImport')}
            </h2>
          }
          meta={t('users.next.panel.importMeta')}
        >
          <BulkImportPanel baseUrl={baseUrl} companyId={companyId} onImported={state.reload} />
          <div>
            <Button type="button" variant="ghost" onClick={() => setOpen('none')}>
              {t('users.next.panel.close')}
            </Button>
          </div>
        </Panel>
      )}

      {state.status === 'error' ? (
        <NetworkError
          title={t('users.next.loadFailed')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status !== 'ready'} label={t('common.loading')}>
          {state.status !== 'ready' ? (
            <SkeletonText lines={6} />
          ) : (
            <div className="flex flex-col gap-section">
              <Tiles tally={tally} invitations={state.invitations} />

              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[17rem_minmax(0,1fr)]">
                <DepartmentRail
                  groups={groups}
                  tally={tally}
                  selected={groupId}
                  onSelect={(id) => setParam(GROUP_PARAM, id === ALL_PEOPLE ? null : id)}
                />
                <div className="flex min-w-0 flex-col gap-4">
                  {editing && (
                    <EditPerson
                      key={editing.id}
                      user={editing}
                      departments={state.departments ?? []}
                      canAssignRoles={capabilities.canAssignRoles}
                      onClose={() => setParam(EDIT_PARAM, null)}
                      onReload={state.reload}
                    />
                  )}
                  <Roster
                    heading={selectedGroup ? groupName(t, selectedGroup) : t('users.next.rail.all')}
                    people={inSelection}
                    visible={visible}
                    total={state.users.length}
                    deactivated={tally.deactivated}
                    companyName={companyName}
                    search={search}
                    searchId={searchId}
                    onSearch={setSearch}
                    editingId={editing?.id ?? null}
                    onEdit={(user) => setParam(EDIT_PARAM, user.id)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <PendingInvitations invitations={state.invitations} onResend={handleResend} />
                <HowSomeoneGetsIn />
              </div>
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

type Translate = ReturnType<typeof useTranslation>['t']

/**
 * A role as the roster's chip prints it. The Rol column is the board's 120px, which holds its
 * one-word chips (Líder, Supervisora, Empleado) but not «Administrador de empresa» — the chip
 * clipped it to «Administrador d». An administrator's chip says «Administrador» beside the
 * shield and carries the full role in its title; every other role keeps its own name.
 */
function rosterRole(t: Translate, role: string): { label: string; title?: string } {
  const full = roleText(t, role)
  return role === 'company_admin' ? { label: t('users.next.roster.roleAdmin'), title: full } : { label: full }
}

function groupName(t: Translate, entry: DepartmentGroup): string {
  if (entry.id === NO_DEPARTMENT) return t('users.next.rail.none')
  return entry.name ?? t('users.next.rail.unnamed')
}

function Tiles({ tally, invitations }: { tally: ReturnType<typeof rosterTally>; invitations: readonly Invitation[] | null }) {
  const { t, locale } = useTranslation()
  const pending = invitations === null ? null : pendingRows(invitations).length
  const departmentParts = [
    tally.withoutDepartment > 0 ? t('users.next.tiles.withoutDepartment', { count: tally.withoutDepartment }) : null,
    tally.inactiveEmpty ? t('users.next.tiles.inactiveEmpty', { count: tally.inactiveEmpty }) : null,
    tally.activeEmpty ? t('users.next.tiles.activeEmpty', { count: tally.activeEmpty }) : null,
  ].filter((part): part is string => part !== null)
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        label={t('users.next.tiles.people')}
        value={tally.active}
        unit={t('users.next.tiles.peopleUnit')}
        locale={locale}
        sub={
          <span>
            {tally.deactivated === 0
              ? t('users.next.tiles.noneDeactivated')
              : tally.deactivated === 1
                ? t('users.next.tiles.deactivatedOne')
                : t('users.next.tiles.deactivatedMany', { count: tally.deactivated })}
          </span>
        }
      />
      <KpiTile
        label={t('users.next.tiles.never')}
        value={tally.never}
        unit={t('users.next.tiles.neverUnit', { total: tally.total })}
        locale={locale}
        sub={
          tally.never === 0 ? (
            <span>{t('users.next.tiles.neverNone')}</span>
          ) : tally.leadersNever > 0 ? (
            <span data-tone="warning" className="text-accent-amber-ink">
              {t('users.next.tiles.neverLeaders', { never: tally.leadersNever, leaders: tally.leaders })}
            </span>
          ) : (
            <span>{t('users.next.tiles.neverNoLeaders')}</span>
          )
        }
      />
      <KpiTile
        label={t('users.next.tiles.departments')}
        value={tally.departmentsWithPeople}
        unit={t('users.next.tiles.departmentsUnit')}
        locale={locale}
        sub={
          <span>
            {tally.departmentsWithPeople === null ? t('users.next.tiles.departmentsUnavailable') : departmentParts.join(' · ')}
          </span>
        }
      />
      <KpiTile
        label={t('users.next.tiles.invitations')}
        value={pending}
        unit={t('users.next.tiles.invitationsUnit')}
        locale={locale}
        sub={
          <span>
            {pending === null
              ? t('users.next.tiles.invitationsUnavailable')
              : pending === 0
                ? t('users.next.tiles.invitationsNone')
                : t('users.next.tiles.invitationsSome', { count: pending })}
          </span>
        }
      />
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

/** "Luis Mora · nunca entró": each name, with the amber note when that person never signed in. */
function Names({ people }: { people: readonly User[] }) {
  const { t } = useTranslation()
  return (
    <>
      {people.map((person, index) => (
        <span key={person.id}>
          {index > 0 && ', '}
          {person.name}
          {!hasSignedIn(person) && (
            <>
              {' · '}
              <span className="text-accent-amber-ink">{t('users.next.rail.neverEntered')}</span>
            </>
          )}
        </span>
      ))}
    </>
  )
}

function GroupSub({ entry }: { entry: DepartmentGroup }) {
  const { t } = useTranslation()
  if (entry.id === NO_DEPARTMENT) {
    return (
      <>
        {entry.members.map((person, index) => (
          <span key={person.id}>
            {index > 0 && ' · '}
            {t('users.next.rail.memberRole', { name: person.name, role: roleText(t, person.role).toLocaleLowerCase() })}
          </span>
        ))}
      </>
    )
  }
  const parts: ReactNode[] = []
  parts.push(
    entry.leaders.length > 0 ? (
      <span key="leader">
        {t('users.next.rail.leader')} <Names people={entry.leaders} />
      </span>
    ) : (
      <span key="leader">{t('users.next.rail.noLeader')}</span>
    ),
  )
  if (entry.supervisors.length > 0)
    parts.push(
      <span key="supervisor">
        {' · '}
        {t('users.next.rail.supervisor')} <Names people={entry.supervisors} />
      </span>,
    )
  return <>{parts}</>
}

function RailItem({
  name,
  people,
  signedIn,
  sub,
  selected,
  onSelect,
}: {
  name: string
  people: number
  signedIn: number
  sub: ReactNode
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  return (
    <li>
      <Button
        type="button"
        variant="ghost"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'flex h-auto w-full flex-col items-stretch gap-1 whitespace-normal rounded-md border-0 border-l-[3px] px-3 py-2 text-left font-normal',
          selected ? 'border-l-fg-primary bg-surface-icon-box hover:not-disabled:bg-surface-icon-box' : 'border-l-transparent',
        )}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-fg-primary">{name}</span>
          <span className="font-mono text-xs tabular-nums text-fg-primary">{people}</span>
        </span>
        <span className="flex items-center gap-2 text-2xs text-fg-tertiary">
          <MiniBar percent={people === 0 ? 0 : (signedIn / people) * 100} />
          {t('users.next.rail.signedIn', { signedIn, total: people })}
        </span>
        <span className="text-2xs leading-snug text-fg-tertiary">{sub}</span>
      </Button>
    </li>
  )
}

function DepartmentRail({
  groups,
  tally,
  selected,
  onSelect,
}: {
  groups: readonly DepartmentGroup[]
  tally: ReturnType<typeof rosterTally>
  selected: string
  onSelect: (id: string) => void
}) {
  const { t, locale } = useTranslation()
  const namedCount = groups.filter((entry) => entry.id !== NO_DEPARTMENT).length
  const noDepartment = groups.find((entry) => entry.id === NO_DEPARTMENT)
  // A sentence, so its small counts are spelled as the board writes them: «cinco departamentos
  // y la administración». The rows under it keep their digits, as the board's do.
  const named = countWord(t, namedCount, locale)
  const allSub =
    noDepartment === undefined
      ? t('users.next.rail.allSubOnly', { count: named })
      : noDepartment.members.every((person) => isAdminRole(person.role))
        ? t('users.next.rail.allSub', { count: named })
        : t('users.next.rail.allSubOthers', { count: named, none: countWord(t, noDepartment.people, locale) })
  return (
    <nav
      aria-label={t('users.next.rail.heading')}
      className="flex min-w-0 flex-col gap-1 rounded-xl border border-line-default bg-surface-card px-2 py-3 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-2 px-3 pb-1">
        <p className={EYEBROW}>{t('users.next.rail.heading')}</p>
        <span className="text-2xs text-fg-tertiary">{t('users.next.rail.meta')}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        <RailItem
          name={t('users.next.rail.all')}
          people={tally.total}
          signedIn={tally.total - tally.never}
          sub={allSub}
          selected={selected === ALL_PEOPLE}
          onSelect={() => onSelect(ALL_PEOPLE)}
        />
        {groups.map((entry) => (
          <RailItem
            key={entry.id}
            name={groupName(t, entry)}
            people={entry.people}
            signedIn={entry.signedIn}
            sub={<GroupSub entry={entry} />}
            selected={selected === entry.id}
            onSelect={() => onSelect(entry.id)}
          />
        ))}
      </ul>
      {tally.inactiveEmpty !== null && tally.inactiveEmpty > 0 && (
        <div className="mx-1 mt-1 border-t border-line-light px-2 pt-2.5">
          <Link to="/departments" className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-fg-secondary">
            {tally.inactiveEmpty === 1
              ? t('users.next.rail.inactiveLinkOne')
              : t('users.next.rail.inactiveLink', { count: tally.inactiveEmpty })}
            <ArrowRight aria-hidden="true" className="size-3" />
          </Link>
        </div>
      )}
    </nav>
  )
}

function Roster({
  heading,
  people,
  visible,
  total,
  deactivated,
  companyName,
  search,
  searchId,
  onSearch,
  editingId,
  onEdit,
}: {
  heading: string
  people: readonly User[]
  visible: readonly User[]
  total: number
  deactivated: number
  companyName: string | null
  search: string
  searchId: string
  onSearch: (value: string) => void
  editingId: string | null
  onEdit: (user: User) => void
}) {
  const { t, locale } = useTranslation()
  const never = people.filter((user) => !hasSignedIn(user)).length
  // The note ends on the company's name, and "Grupo Meridiano S.A." already carries the period
  // the sentence would add — the sentence's own period stands in for it, not a second one.
  const company = (companyName ?? t('navigation.companyAdministration')).replace(/\.$/, '')
  return (
    <section
      aria-labelledby="users-roster"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line-default bg-surface-card shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-baseline gap-2.5">
            <h2 id="users-roster" className="m-0 text-2xl">
              {heading}
            </h2>
            <span className="font-mono text-xs tabular-nums text-fg-tertiary">{people.length}</span>
          </div>
          <span className="text-xs text-fg-tertiary">
            {never === 0 ? t('users.next.roster.subNone') : t('users.next.roster.sub', { never })}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
          <label htmlFor={searchId} className="relative m-0 min-w-0 flex-1 sm:w-60 sm:flex-none">
            <span className="sr-only">{t('users.next.roster.search')}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-tertiary" />
            <Input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder={t('users.next.roster.search')}
              className="w-full pl-8"
            />
          </label>
          <span className="whitespace-nowrap font-mono text-xs tabular-nums text-fg-tertiary">
            {t('users.next.roster.shown', { shown: visible.length, total })}
          </span>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState title={t('users.next.roster.empty')} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[40rem] [&_[data-slot=table-container]]:overflow-visible">
            <Table aria-label={t('users.next.roster.tableLabel', { company })} className="table-fixed">
              {/* The board's grid (1fr / 120 / 130 / 84, 12px gaps and row ends) as cells padded 12px a
                  side: ROL 132px and ÚLTIMA ACTIVIDAD 153px, so at 1440 their labels sit at x=1034 and
                  x=1166, the board's. */}
              <colgroup>
                <col />
                <col className="w-33" />
                <col className="w-38.25" />
                <col className="w-24" />
              </colgroup>
              <thead>
                <tr>
                  <th className={TH}>{t('users.next.roster.colPerson')}</th>
                  <th className={TH}>{t('users.next.roster.colRole')}</th>
                  <th className={TH}>{t('users.next.roster.colLast')}</th>
                  <th className={TH}>
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((user) => (
                  <tr key={user.id} data-user-id={user.id} className={cn(editingId === user.id && 'bg-surface-icon-box')}>
                    <td className="px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={user.name} />
                        <div className="flex min-w-0 flex-col">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-semibold text-fg-primary">{user.name}</span>
                            {!user.isActive && <CanvasChip tone="neutral" label={t('users.next.roster.deactivated')} />}
                          </span>
                          <span className="truncate font-mono text-2xs text-fg-tertiary">{user.email}</span>
                        </div>
                      </div>
                    </td>
                    {/* No right padding: the chip gets the board's whole 120px, the next column's own
                        12px keeping ÚLTIMA ACTIVIDAD on x=1166. */}
                    <td className="min-w-0 py-2.5 pr-0 pl-3">
                      <CanvasChip
                        tone="neutral"
                        icon={isAdminRole(user.role) ? <Shield className="size-3" /> : undefined}
                        {...rosterRole(t, user.role)}
                        className="max-w-full truncate"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      {user.lastLoginAt ? (
                        <span className="font-mono text-xs tabular-nums text-fg-primary">
                          {calendarDay(Date.parse(user.lastLoginAt), locale)}
                        </span>
                      ) : (
                        <span className="text-xs text-accent-amber-ink">{t('users.next.roster.never')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={t('users.next.roster.editNamed', { name: user.name })}
                        onClick={() => onEdit(user)}
                      >
                        {t('users.next.roster.edit')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}
      <p className="m-0 flex flex-wrap items-center gap-1.5 border-t border-line-light px-4 py-2.5 text-xs text-fg-tertiary">
        <Info aria-hidden="true" className="size-3.5 shrink-0" />
        <span>{t('users.next.roster.noteLead')}</span>
        <CanvasChip tone="neutral" label={t('users.next.roster.deactivated')} />
        <span>
          {deactivated === 0
            ? t('users.next.roster.noteTailNone', { company })
            : t('users.next.roster.noteTailSome', { count: deactivated, company })}
        </span>
      </p>
    </section>
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
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [name, setName] = useState(user.name)
  const [departmentId, setDepartmentId] = useState(user.departmentId ?? '')
  const [isActive, setIsActive] = useState(user.isActive)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { name: useId(), department: useId(), role: useId(), active: useId() }
  // Deactivating an administrator is the super administrator's alone (`UserEndpoints.cs:147-149`):
  // the server refuses even an unchanged `isActive` for one, so it is only ever sent when changed.
  const accountLocked = isAdminRole(user.role) && !canAssignRoles
  // The API can move a person to a department but not out of one (`UpdateUserInput` carries a
  // department only when set), so "none" is offered only to someone who has none.
  const options = departments.filter((unit) => unit.isActive || unit.id === user.departmentId)
  const created = calendarDay(Date.parse(user.createdAt), locale)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await updateUser(baseUrl, user.id, {
        name: name.trim(),
        ...(isActive !== user.isActive ? { isActive } : {}),
        ...(departmentId && departmentId !== user.departmentId ? { departmentId } : {}),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('users.next.edit.saveFailed'))
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
            {t('users.next.edit.title', { name: user.name })}
          </h2>
        </div>
      }
      meta={
        user.lastLoginAt
          ? t('users.next.edit.metaLast', { last: calendarDay(Date.parse(user.lastLoginAt), locale), created })
          : t('users.next.edit.metaNever', { created })
      }
      className="gap-3.5"
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {t('users.next.edit.saveFailed')}: {error}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
        <Field fieldLabel={t('users.next.edit.name')} htmlFor={ids.name}>
          <Input id={ids.name} value={name} onChange={(event) => setName(event.target.value)} className="w-full" />
        </Field>
        <Field fieldLabel={t('users.next.edit.department')} htmlFor={ids.department} helper={t('users.next.edit.departmentHelper')}>
          <CanvasSelect id={ids.department} className="w-full" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            {!user.departmentId && <option value="">{t('users.next.rail.none')}</option>}
            {options.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </CanvasSelect>
        </Field>
        <Field fieldLabel={t('users.next.edit.role')} htmlFor={ids.role} helper={t('users.next.edit.roleLocked')}>
          <div
            data-slot="role-locked"
            className="flex h-control-lg items-center gap-2 rounded-md border border-line-default bg-surface-icon-box px-2.5 text-fg-secondary"
          >
            <Lock aria-hidden="true" className="size-3.5 shrink-0 text-fg-tertiary" />
            <input id={ids.role} readOnly value={roleText(t, user.role)} className="h-auto w-full min-w-0 border-0 bg-transparent p-0 text-fg-secondary" />
          </div>
        </Field>
        <Field
          fieldLabel={t('users.next.edit.account')}
          htmlFor={ids.active}
          helper={accountLocked ? t('users.next.edit.accountLocked') : t('users.next.edit.accountHelper')}
        >
          <span className="inline-flex h-control-lg items-center gap-2 text-sm text-fg-secondary">
            <Switch
              id={ids.active}
              checked={isActive}
              disabled={accountLocked}
              onCheckedChange={setIsActive}
              className="data-[state=checked]:bg-accent-green"
            />
            <span>{isActive ? t('users.next.edit.active') : t('users.next.edit.inactive')}</span>
          </span>
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-light pt-3">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button type="button" variant="outline" onClick={() => void save()} disabled={saving || !name.trim()}>
          <Check aria-hidden="true" />
          {t('users.next.edit.save')}
        </Button>
      </div>
    </Panel>
  )
}

function PendingInvitations({
  invitations,
  onResend,
}: {
  invitations: readonly Invitation[] | null
  onResend: (invitation: Invitation) => Promise<void>
}) {
  const { t, locale } = useTranslation()
  const rows = invitations === null ? null : pendingRows(invitations)
  const [resending, setResending] = useState<string | null>(null)
  return (
    <section
      aria-labelledby="users-invitations"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line-default bg-surface-card shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 pb-2">
        <div className="flex items-baseline gap-2.5">
          <h2 id="users-invitations" className="m-0 text-2xl">
            {t('users.next.invitations.heading')}
          </h2>
          {rows !== null && <span className="font-mono text-xs tabular-nums text-fg-tertiary">{rows.length}</span>}
        </div>
        <span className="text-xs text-fg-tertiary">{t('users.next.invitations.meta')}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[42rem] [&_[data-slot=table-container]]:overflow-visible">
          <Table aria-label={t('users.next.invitations.heading')} className="table-fixed">
            {/* The board's five columns (1.6fr / 110 / 100 / 100 / 120, 12px gaps) as cells padded 12px
                a side, CORREO the flexible one: at 1440 the labels sit at x=274 / 534 / 656 / 768 / 880,
                the board's. It draws no sixth column, so Reenviar rides in the Recordatorios cell, beside
                the count it raises (`InvitationEndpoints.cs:252-256`). */}
            <colgroup>
              <col />
              <col className="w-30.5" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-35.75" />
            </colgroup>
            <thead>
              <tr>
                <th className={TH}>{t('users.next.invitations.colEmail')}</th>
                <th className={TH}>{t('users.next.invitations.colRole')}</th>
                <th className={TH}>{t('users.next.invitations.colSent')}</th>
                <th className={TH}>{t('users.next.invitations.colExpires')}</th>
                <th className={TH}>{t('users.next.invitations.colReminders')}</th>
              </tr>
            </thead>
            <tbody>
              {rows === null || rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-3">
                    <span className="flex items-start gap-2 text-sm text-fg-secondary">
                      <Mail aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-tertiary" />
                      {rows === null ? t('users.next.invitations.unavailable') : t('users.next.invitations.empty')}
                    </span>
                  </td>
                </tr>
              ) : (
                rows.map((invitation) => (
                  <tr key={invitation.id}>
                    <td className="truncate px-3 py-2.5 font-mono text-xs text-fg-primary">
                      {invitation.email ?? t('users.next.invitations.link')}
                    </td>
                    <td className="px-3 py-2.5">
                      <CanvasChip tone="neutral" label={roleText(t, invitation.role)} />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-fg-secondary">
                      {invitation.sentAt ? calendarDay(Date.parse(invitation.sentAt), locale) : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-fg-secondary">
                      {calendarDay(Date.parse(invitation.expiresAt), locale)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs tabular-nums text-fg-secondary">{invitation.reminderCount}</span>
                        {invitation.email && (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={resending === invitation.id}
                            onClick={() => {
                              setResending(invitation.id)
                              void onResend(invitation).finally(() => setResending(null))
                            }}
                          >
                            {t('users.next.invitations.resend')}
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </div>
    </section>
  )
}

function HowSomeoneGetsIn() {
  const { t } = useTranslation()
  const ways = [
    { key: 'email', icon: <Mail />, title: t('users.next.how.emailTitle'), text: t('users.next.how.emailText') },
    { key: 'link', icon: <Link2 />, title: t('users.next.how.linkTitle'), text: t('users.next.how.linkText') },
    { key: 'import', icon: <Upload />, title: t('users.next.how.importTitle'), text: t('users.next.how.importText') },
  ]
  return (
    <Panel
      labelledBy="users-how"
      heading={
        <h2 id="users-how" className="m-0 text-2xl">
          {t('users.next.how.heading')}
        </h2>
      }
    >
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {ways.map((way) => (
          <li key={way.key} className="flex items-start gap-3">
            <IconBox size="sm">{way.icon}</IconBox>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold text-fg-primary">{way.title}</span>
              <span className="text-xs leading-snug text-fg-secondary">{way.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <Note icon={<Shield />}>{t('users.next.how.note')}</Note>
    </Panel>
  )
}
