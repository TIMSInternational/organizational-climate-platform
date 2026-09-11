import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CircleAlert, MoreHorizontal, Network, Plus, Users } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { ANONYMITY_FLOOR, formatMetric } from '../../../../components/charts'
import { PROTECTED_HATCH } from '../../../../components/charts/suppression'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  NetworkError,
  SkeletonText,
  Switch,
} from '../../../../components/ui'
import { useCompanyScope } from '../../../../company-context'
import { useCompanyName } from '../../../../company-context/useCompanyName'
import { readViewerClaims, useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { cn } from '../../../../lib/cn'
import { CLIMATE_TARGET } from '../../../dashboard/next/compose'
import { createDepartment, updateDepartment, type Department } from '../../api/departments'
import DepartmentForm, { type DepartmentFormValues } from '../../components/DepartmentForm'
import { CanvasChip } from '../super/parts'
import { noteOf, type ClimateReading, type DepartmentRow, type PlansReading, type Wave } from './derive'
import { useDepartmentsModel, type DepartmentsModel } from './useDepartmentsModel'

const K = 'departments.next'
const DASH = '—'
const HEAD = 'px-3 py-2 text-left text-2xs font-bold uppercase leading-normal tracking-label text-fg-label whitespace-nowrap'

function score(value: number, locale: string): string {
  return formatMetric(value, { kind: 'number', decimals: 1 }, locale)
}

/**
 * `/departments` — the Departments artboard, which replaced `DepartmentsPage` on this route
 * (the old page stays in the tree, unrouted, as the wiring reference).
 *
 * Who is in each area, who leads it and which plans it has open: four tiles, the organigram of
 * the active departments, and the list with the latest closed wave's climate beside each row.
 * Inactive departments are behind a toggle, as the artboard draws them. "Importar personas"
 * surfaces the bulk import the users page already has (`?import=1` opens it), because the
 * people file is what places each person in a department.
 *
 * Roles: every request here is `canManageOrg` (`DepartmentEndpoints.cs:24-26`); a viewer
 * without it is told so and nothing is asked. Privacy: a department under the floor prints
 * "protegido" in the climate column and its card says so — never a number, never a count.
 */
export default function DepartmentsNextPage() {
  const { t } = useTranslation()
  const capabilities = useViewerCapabilities()
  const scope = useCompanyScope()
  const companyName = useCompanyName()
  const companyId = capabilities.canManageOrg ? (scope.companyId ?? null) : null
  const superScope = readViewerClaims().role === 'super_admin' ? (scope.companyId ?? undefined) : undefined
  const state = useDepartmentsModel(companyId, superScope)
  const header = { eyebrow: companyName, title: t('navigation.departments'), description: t(`${K}.description`, { threshold: ANONYMITY_FLOOR }) }

  if (scope.status === 'needs-selection') {
    return (
      <div>
        <PageTopBar {...header} />
        <EmptyState title={t('companyContext.chooseACompany')} description={t('companyContext.chooseACompanyDescription')} />
      </div>
    )
  }
  if (!companyId) {
    return (
      <div>
        <PageTopBar {...header} />
        <EmptyState title={t(`${K}.notAllowedTitle`)} description={t(`${K}.notAllowedBody`)} />
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div>
        <PageTopBar {...header} />
        <NetworkError
          title={t('departments.failedLoadDepartments')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      </div>
    )
  }
  if (!state.model) {
    return (
      <div>
        <PageTopBar {...header} />
        <SkeletonText lines={8} />
      </div>
    )
  }
  return <DepartmentsView companyId={companyId} companyName={companyName} model={state.model} onChanged={state.reload} />
}

function DepartmentsView({
  companyId,
  companyName,
  model,
  onChanged,
}: {
  companyId: string
  companyName: string | null
  model: DepartmentsModel
  onChanged: () => void
}) {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [showInactive, setShowInactive] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const { rows, summary, wave } = model
  const active = rows.filter((row) => row.isActive)
  const listed = showInactive ? rows : active
  const waveCode = wave?.code ?? DASH

  async function handleCreate(values: DepartmentFormValues) {
    await createDepartment(baseUrl, {
      companyId,
      name: values.name,
      description: values.description || undefined,
      parentDepartmentId: values.parentDepartmentId || undefined,
      isActive: values.isActive,
    })
    setCreating(false)
    onChanged()
  }

  async function handleUpdate(values: DepartmentFormValues) {
    if (!editing) return
    await updateDepartment(baseUrl, editing.id, { name: values.name, description: values.description, isActive: values.isActive })
    setEditing(null)
    onChanged()
  }

  return (
    <div>
      <PageTopBar
        eyebrow={companyName}
        title={t('navigation.departments')}
        description={t(`${K}.description`, { threshold: ANONYMITY_FLOOR })}
        actions={
          <>
            <Button asChild variant="outline" size="canvas">
              <Link to={`/admin/companies/${companyId}/users?import=1`}>
                <Users aria-hidden="true" />
                {t(`${K}.importPeople`)}
              </Link>
            </Button>
            <Button
              variant="primary"
              size="canvas"
              onClick={() => {
                setEditing(null)
                setCreating((open) => !open)
              }}
            >
              {creating ? null : <Plus aria-hidden="true" />}
              {creating ? t('common.cancel') : t('departments.newDepartment')}
            </Button>
          </>
        }
      />

      {(creating || editing) && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{editing ? t('departments.editDepartment') : t('departments.createNewDepartment')}</CardTitle>
          </CardHeader>
          <CardContent>
            {editing ? (
              <>
                <DepartmentForm
                  key={editing.id}
                  departments={model.departments}
                  excludeIdFromParentOptions={editing.id}
                  parentLocked
                  initialValues={{
                    name: editing.name,
                    description: editing.description ?? '',
                    parentDepartmentId: editing.parentDepartmentId ?? '',
                    isActive: editing.isActive,
                  }}
                  submitLabel={t('departments.saveChanges')}
                  onSubmit={handleUpdate}
                />
                <Button variant="ghost" className="mt-3" onClick={() => setEditing(null)}>
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <DepartmentForm departments={model.departments} submitLabel={t('departments.createDepartment')} onSubmit={handleCreate} />
            )}
          </CardContent>
        </Card>
      )}

      <div className="-mt-1 flex flex-col gap-6">
        <section aria-label={t(`${K}.summaryLabel`)} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label={t(`${K}.tileActive`)} value={summary.active} unit={t(`${K}.tileActiveUnit`)} />
          <Tile label={t(`${K}.tilePeople`)} value={summary.people} unit={t(`${K}.tilePeopleUnit`)} />
          <Tile
            label={t(`${K}.tileInactive`)}
            value={summary.inactive}
            unit={t(`${K}.tileInactiveUnit`)}
            sub={<span className="text-xs text-fg-tertiary">{t(`${K}.tileInactiveSub`)}</span>}
          />
          <Tile
            label={t(`${K}.tilePlans`)}
            value={summary.plans ? summary.plans.open : null}
            unit={t(`${K}.tilePlansUnit`)}
            sub={
              summary.plans === null ? (
                <span className="text-xs text-fg-tertiary">{t(`${K}.plansUnavailable`)}</span>
              ) : summary.plans.overdue > 0 ? (
                <span data-slot="overdue-line" className="inline-flex items-center gap-1.5 text-xs text-accent-red">
                  <CircleAlert aria-hidden="true" className="size-3.5" />
                  {summary.plans.firstOverdue
                    ? t(`${K}.overdueIn`, { count: summary.plans.overdue, department: summary.plans.firstOverdue })
                    : t(`${K}.overdue`, { count: summary.plans.overdue })}
                </span>
              ) : (
                <span className="text-xs text-fg-tertiary">{t(`${K}.noneOverdue`)}</span>
              )
            }
          />
        </section>

        <section aria-labelledby="departments-chart" className="flex flex-col">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="departments-chart" className="m-0 text-xl">
              {t(`${K}.chartHeading`)}
            </h2>
            <span className="text-xs text-fg-tertiary">{t(`${K}.chartMeta`)}</span>
          </div>
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-3 rounded-xl border border-line-default bg-surface-icon-box px-4.5 py-2.5 shadow-sm">
              <span className="inline-flex size-7 items-center justify-center rounded-md bg-surface-icon-box text-fg-secondary">
                <Network aria-hidden="true" className="size-4" />
              </span>
              <span className="flex flex-col">
                <span className="text-base font-semibold">{companyName ?? DASH}</span>
                <span className="text-2xs text-fg-tertiary">
                  {t(`${K}.rootMeta`, { departments: summary.active, people: summary.people })}
                </span>
              </span>
            </div>
            <div aria-hidden="true" className="hidden w-full flex-col items-center xl:flex">
              <span className="h-4.5 w-px bg-line-default" />
              <span className="h-px w-4/5 bg-line-default" />
              <span className="grid w-full grid-cols-5">
                {active.slice(0, 5).map((row) => (
                  <span key={row.id} className="flex justify-center">
                    <span className="h-3.5 w-px bg-line-default" />
                  </span>
                ))}
              </span>
            </div>
          </div>
          <ul className="m-0 mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3 xl:mt-0 xl:grid-cols-5">
            {active.map((row) => (
              <li key={row.id} data-slot="department-card" data-department={row.name} className="flex min-w-0 flex-col gap-2 rounded-xl border border-line-default bg-surface-card px-4 py-3.5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-lg font-semibold">{row.name}</span>
                  <CanvasChip tone="good" label={t(`${K}.active`)} />
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-2xl leading-none tabular-nums">{row.people}</span>
                  <span className="text-xs text-fg-tertiary">{t(`${K}.peopleUnit`)}</span>
                </div>
                <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-xs">
                  <dt className="text-fg-tertiary">{t(`${K}.leader`)}</dt>
                  <dd className="m-0 truncate">{row.leaders && row.leaders.length > 0 ? row.leaders.join(', ') : DASH}</dd>
                  <dt className="text-fg-tertiary">{t(`${K}.plans`)}</dt>
                  <dd className="m-0">
                    <PlansCell plans={row.plans} t={t} />
                  </dd>
                </dl>
                <CardNoteLine row={row} wave={wave} t={t} locale={locale} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="departments-list" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="departments-list" className="m-0 text-xl">
              {t(`${K}.listHeading`)}
            </h2>
            <span className="text-xs text-fg-tertiary">{t(`${K}.listMeta`)}</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-line-light">
            <div className="overflow-x-auto">
              <table className="m-0 w-full min-w-215 border-collapse text-xs">
                <thead className="bg-surface-icon-box">
                  <tr>
                    <th scope="col" className={HEAD}>{t(`${K}.colDepartment`)}</th>
                    <th scope="col" className={HEAD}>{t(`${K}.colPeople`)}</th>
                    <th scope="col" className={HEAD}>{t(`${K}.leader`)}</th>
                    <th scope="col" className={HEAD}>{t(`${K}.colPlans`)}</th>
                    <th scope="col" className={HEAD}>{t(`${K}.colClimate`, { wave: waveCode })}</th>
                    <th scope="col" className={HEAD}>{t(`${K}.colStatus`)}</th>
                    <th scope="col" className={HEAD}>
                      <span className="sr-only">{t(`${K}.colActions`)}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map((row) => (
                    <tr key={row.id} data-department-row={row.name} className="border-t border-line-light">
                      <td className="px-3 py-2.5 font-medium">{row.name}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums">{row.people}</td>
                      <td className="px-3 py-2.5 text-fg-secondary">
                        {row.leaders && row.leaders.length > 0 ? row.leaders.join(', ') : DASH}
                      </td>
                      <td className="px-3 py-2.5">
                        <PlansCell plans={row.plans} t={t} />
                      </td>
                      <td className="px-3 py-2.5">
                        <ClimateCell climate={row.climate} t={t} locale={locale} />
                      </td>
                      <td className="px-3 py-2.5">
                        {row.isActive ? <CanvasChip tone="good" label={t(`${K}.active`)} /> : <CanvasChip label={t(`${K}.inactive`)} />}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex justify-end gap-1.5">
                          <Button asChild variant="outline" size="sm">
                            <Link to={`/admin/companies/${companyId}/users`}>{t(`${K}.people`)}</Link>
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="icon" className="size-7" aria-label={t(`${K}.moreActions`, { department: row.name })}>
                                <MoreHorizontal aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={() => {
                                  setCreating(false)
                                  setEditing(model.departments.find((department) => department.id === row.id) ?? null)
                                }}
                              >
                                {t('departments.editDepartment')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-light bg-surface-card-hover px-3 py-2.5 text-xs text-fg-tertiary">
              <span>
                {summary.inactive === 0
                  ? t(`${K}.noInactive`)
                  : showInactive
                    ? t(`${K}.inactiveShown`, { count: summary.inactive })
                    : t(`${K}.inactiveHidden`, { count: summary.inactive })}
              </span>
              {summary.inactive > 0 && (
                <label className="m-0 inline-flex items-center gap-2 text-xs text-fg-secondary">
                  <Switch checked={showInactive} onCheckedChange={setShowInactive} />
                  {t(`${K}.showInactive`)}
                </label>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function Tile({ label, value, unit, sub }: { label: string; value: number | null; unit: string; sub?: ReactNode }) {
  return (
    <div data-slot="departments-tile" className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line-default bg-surface-card px-4 py-3.5 shadow-sm">
      <span className="text-2xs font-bold uppercase tracking-label text-fg-label">{label}</span>
      <span className="flex flex-wrap items-baseline gap-1.5">
        <span className="font-mono text-kpi-lg leading-none tabular-nums">{value ?? DASH}</span>
        <span className="text-xs text-fg-tertiary">{unit}</span>
      </span>
      {sub}
    </div>
  )
}

function PlansCell({ plans, t }: { plans: PlansReading | null; t: TranslateFn }) {
  if (!plans || plans.open === 0) return <span className="font-mono text-fg-tertiary">{DASH}</span>
  if (plans.overdue > 0) {
    return <span className="font-mono text-accent-red">{t(`${K}.plansOverdue`, { open: plans.open, overdue: plans.overdue })}</span>
  }
  if (plans.notStarted === plans.open) {
    return <span className="font-mono text-accent-amber-ink">{t(`${K}.plansNotStarted`, { open: plans.open })}</span>
  }
  return <span className="font-mono">{plans.open}</span>
}

function ClimateCell({ climate, t, locale }: { climate: ClimateReading; t: TranslateFn; locale: string }) {
  if (climate.kind === 'protected') {
    return (
      <span
        data-slot="protected-cell"
        className={cn('inline-flex h-5.5 w-17.5 items-center justify-center rounded bg-surface-panel font-mono text-2xs text-fg-light', PROTECTED_HATCH)}
      >
        {t(`${K}.protected`)}
      </span>
    )
  }
  if (climate.kind === 'none') return <span className="font-mono text-fg-tertiary">{DASH}</span>
  const below = climate.mean < CLIMATE_TARGET
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono tabular-nums">{score(climate.mean, locale)}</span>
      <span className="text-fg-tertiary">
        {below
          ? t(`${K}.belowTarget`, { target: score(CLIMATE_TARGET, locale) })
          : t(`${K}.meanOf`, { count: climate.dimensions })}
      </span>
    </span>
  )
}

function CardNoteLine({ row, wave, t, locale }: { row: DepartmentRow; wave: Wave | null; t: TranslateFn; locale: string }) {
  const note = noteOf(row, wave, CLIMATE_TARGET)
  const base = 'border-t border-line-light pt-1.5 text-2xs'
  if (note.kind === 'protected') return <span className={cn(base, 'text-fg-tertiary')}>{t(`${K}.noteProtected`, { wave: note.wave, threshold: ANONYMITY_FLOOR })}</span>
  if (note.kind === 'lowest') {
    const key = `surveyRespond.dimensions.${note.key}`
    const name = t(key)
    return (
      <span className={cn(base, 'text-fg-tertiary')}>
        {t(`${K}.noteLowest`, { dimension: name === key ? note.key : name, score: score(note.score, locale), wave: note.wave })}
      </span>
    )
  }
  if (note.kind === 'supervisor') return <span className={cn(base, 'text-fg-tertiary')}>{t(`${K}.noteSupervisor`, { names: note.names.join(', ') })}</span>
  return <span className={cn(base, 'text-fg-light')}>{t(`${K}.noteNone`)}</span>
}
