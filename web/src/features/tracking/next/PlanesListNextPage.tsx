import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Check, ChevronRight, CircleAlert, Clock, LayoutPanelTop, Plus, Shield } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KpiTile } from '../../../components/charts'
import { Alert, AlertDescription, Button, EmptyState, LoadingRegion, NetworkError, SkeletonText, Table } from '../../../components/ui'
import { useCompanyName } from '../../../company-context/useCompanyName'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { KpiRow } from '../../dashboard/components/dashboardGrammar'
import { createPlanAccion, type CreatePlanAccionInput, type PlanAccion } from '../api/trackingApi'
import PlanDeAccionForm from '../components/PlanDeAccionForm'
import { SEMAFORO_ORDER, semaforoPresentation, type SemaforoEstado } from '../semaforo'
import { canCreatePlan, readTrackingClaims } from '../trackingAccess'
import { CanvasSelect } from '../../org-structure/next/super/parts'
import { joinNames } from './derive'
import { PersonaAvatar, ProgressTrack } from './parts'
import { coverage, groupRows, nodoNamesOf, toRows, type ListRow } from './planesList'
import { usePlanesListModel } from './usePlanesListModel'

const TH = 'h-auto bg-transparent px-3 pb-2 pt-2 text-2xs font-bold uppercase tracking-label text-fg-label whitespace-nowrap'
const ALL = ''

const TONE_INK: Record<string, string> = {
  critical: 'text-accent-red',
  warning: 'text-accent-amber-ink',
  good: 'text-accent-green-ink',
}

const STATE_ICON: Record<SemaforoEstado, ReactNode> = {
  Rojo: <CircleAlert aria-hidden="true" className="size-4" />,
  Amarillo: <Clock aria-hidden="true" className="size-4" />,
  Verde: <Check aria-hidden="true" className="size-4" />,
}

const TILE_SUB: Record<SemaforoEstado, string> = {
  Rojo: 'tracking.next.planesTileRojo',
  Amarillo: 'tracking.next.planesTileAmarillo',
  Verde: 'tracking.next.planesTileVerde',
}
const SECTION_NOTE: Record<SemaforoEstado, string> = {
  Rojo: 'tracking.next.planesNoteRojo',
  Amarillo: 'tracking.next.planesNoteAmarillo',
  Verde: 'tracking.next.planesNoteVerde',
}
const SECTION_EMPTY: Record<SemaforoEstado, string> = {
  Rojo: 'tracking.next.planesEmptyRojo',
  Amarillo: 'tracking.next.planesEmptyAmarillo',
  Verde: 'tracking.next.planesEmptyVerde',
}
const LEGEND: Record<SemaforoEstado, string> = {
  Rojo: 'tracking.next.planesLegendRojo',
  Amarillo: 'tracking.next.planesLegendAmarillo',
  Verde: 'tracking.next.planesLegendVerde',
}

/**
 * `/tracking/planes` — the redesigned *Planes de acción* (TrackingPlanesList artboard,
 * 10 Sep). It replaced `pages/PlanesAccionListPage.tsx` on this route; that page stays in the
 * tree, unrouted, as the wiring reference.
 *
 * The semáforo tally first, then every plan grouped by its state — atrasado, en riesgo, al
 * día — with its nodo and responsable by name and the code linking to the plan, the fulfilled
 * ones folded away. The state is the service's (`estadoSemaforo`); the page only groups.
 *
 * ## Roles
 *
 * The service scopes the list, so every role gets this page and sees only what it may. What
 * the page adds per role is what it offers: "Vista consolidada" to whom `/tracking` answers
 * (`canViewConsolidado`), "Nuevo plan" to whom the service lets create (`canCreatePlan`),
 * "Registrar avance" on the plans the viewer may record progress on (`canManagePlan`) and
 * "Abrir" on the rest. Names come from the directory only an administrator may read; anyone
 * else sees their own name and "responsable fuera del directorio" for the others.
 */
export default function PlanesListNextPage() {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const companyName = useCompanyName()
  const claims = useMemo(() => readTrackingClaims(), [])
  const state = usePlanesListModel()
  const [nodo, setNodo] = useState(ALL)
  const [estado, setEstado] = useState(ALL)
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [created, setCreated] = useState<PlanAccion | null>(null)
  const mayCreate = canCreatePlan(claims)

  const names = useMemo(() => new Map((state.nodos ?? []).map((item) => [item.id, item.name])), [state.nodos])
  const rows = useMemo(
    () => toRows(state.plans, state.asOf, names, state.personas, state.viewer, claims),
    [state.plans, state.asOf, names, state.personas, state.viewer, claims],
  )
  const all = groupRows(rows)
  const filtered = rows.filter((row) => (nodo === ALL || row.nodoExternalId === nodo) && (estado === ALL || row.estado === estado))
  const shown = groupRows(filtered)
  const nodoOrder = (state.nodos ?? []).map((item) => item.id)
  const nodoOptions = state.nodos
    ? state.nodos.map((item) => ({ id: item.id, name: item.name }))
    : [...new Set(rows.map((row) => row.nodoExternalId))].map((id) => ({ id, name: names.get(id) ?? t('tracking.next.nodoUnnamed') }))

  async function handleCreate(input: CreatePlanAccionInput) {
    setSubmitting(true)
    setCreateError(null)
    try {
      const plan = await createPlanAccion(input)
      setCreated(plan)
      setCreating(false)
      state.reload()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('tracking.serviceUnavailableTitle'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-section">
      <div className="-mb-6">
        <PageTopBar
          eyebrow={companyName ? t('tracking.next.consolidadoEyebrow', { company: companyName }) : t('tracking.next.consolidadoEyebrowBare')}
          title={t('tracking.next.planesTitle')}
          description={t('tracking.next.planesDescription')}
          actions={
            capabilities.canViewConsolidado || mayCreate ? (
              <>
                {capabilities.canViewConsolidado && (
                  <Button asChild variant="outline">
                    <Link to="/tracking">
                      <LayoutPanelTop aria-hidden="true" />
                      {t('tracking.next.planesConsolidado')}
                    </Link>
                  </Button>
                )}
                {mayCreate && (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      setCreated(null)
                      setCreateError(null)
                      setCreating((open) => !open)
                    }}
                  >
                    <Plus aria-hidden="true" />
                    {t('tracking.actions.newPlan')}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      </div>

      {created && (
        <Alert variant="success">
          <AlertDescription>{t('tracking.planes.created', { code: created.planCode })}</AlertDescription>
        </Alert>
      )}

      {creating && (
        <section
          aria-labelledby="planes-create"
          className="flex flex-col gap-3 rounded-xl border border-line-default border-l-[3px] border-l-fg-primary bg-surface-card px-5 py-4 shadow-sm"
        >
          <h2 id="planes-create" className="m-0 text-2xl">
            {t('tracking.actions.createPlan')}
          </h2>
          <PlanDeAccionForm
            claims={claims}
            nodos={[...(state.nodos ?? [])]}
            personas={[...state.personas]}
            directoryUnavailable={state.directoryUnavailable || state.nodos === null}
            submitting={submitting}
            error={createError}
            onSubmit={(input) => void handleCreate(input)}
            onCancel={() => setCreating(false)}
          />
        </section>
      )}

      {state.status === 'error' ? (
        // `tracking.serviceUnavailable*`, as the old page: never the browser's own words.
        <NetworkError
          title={t('tracking.serviceUnavailableTitle')}
          description={t('tracking.serviceUnavailableBody')}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' ? (
            // No tiles while loading: a strip of zeros is a reading nobody took.
            <SkeletonText lines={6} />
          ) : rows.length === 0 ? (
            <EmptyState title={mayCreate ? t('tracking.next.planesEmptyAll') : t('tracking.next.planesEmptyMine')} />
          ) : (
            <div className="flex flex-col gap-section">
              <Tiles rows={rows} grouped={all} nodoOrder={nodoOrder} t={t} locale={locale} />

              <div className="flex flex-col gap-4">
                <Filters
                  nodo={nodo}
                  estado={estado}
                  nodoOptions={nodoOptions}
                  onNodo={setNodo}
                  onEstado={setEstado}
                  summary={<CoverageLine rows={rows} directory={state.nodos} t={t} locale={locale} />}
                  t={t}
                />
                {filtered.length === 0 ? (
                  <EmptyState title={t('tracking.next.planesFilterEmpty')} />
                ) : (
                  <>
                    {SEMAFORO_ORDER.filter((key) => estado === ALL || estado === key).map((key) => (
                      <StateSection key={key} estado={key} rows={shown.byEstado[key]} t={t} locale={locale} />
                    ))}
                    {shown.unknown.length > 0 && <UnknownSection rows={shown.unknown} t={t} locale={locale} />}
                  </>
                )}
                {estado === ALL && <Cumplidos rows={shown.cumplidos} t={t} locale={locale} />}
              </div>

              <Legend asOf={state.asOf} t={t} locale={locale} />
              <div className="flex items-start gap-2.5 rounded-lg bg-surface-icon-box px-3.5 py-3 text-sm leading-normal text-fg-secondary">
                <Shield aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{t('tracking.next.planesWhoWrites')}</span>
              </div>
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

function Tiles({
  rows,
  grouped,
  nodoOrder,
  t,
  locale,
}: {
  rows: readonly ListRow[]
  grouped: ReturnType<typeof groupRows>
  nodoOrder: readonly string[]
  t: TranslateFn
  locale: string
}) {
  const nodos = new Set(rows.map((row) => row.nodoExternalId)).size
  const withProgress = rows.filter((row) => row.hasProgress).length
  const cumplidos = grouped.cumplidos.length
  const sub = [
    withProgress === 0 ? t('tracking.next.planesNoneWithProgress') : t('tracking.next.planesWithProgress', { count: withProgress }),
    cumplidos === 0
      ? t('tracking.next.planesNoneCumplido')
      : cumplidos === 1
        ? t('tracking.next.planesCumplidoOne')
        : t('tracking.next.planesCumplidoMany', { count: cumplidos }),
  ].join(' · ')
  return (
    <KpiRow>
      <KpiTile
        label={t('tracking.totalPlanes')}
        value={rows.length}
        locale={locale}
        unit={nodos === 1 ? t('tracking.next.inOneNodo') : t('tracking.next.inNodos', { count: nodos })}
        sub={<span className="text-fg-label">{sub}</span>}
      />
      {SEMAFORO_ORDER.map((estado) => {
        const presentation = semaforoPresentation(estado)
        const list = grouped.byEstado[estado]
        const count = list.length
        const nodoNames = nodoNamesOf(list, nodoOrder)
        const definition = t(TILE_SUB[estado])
        return (
          <KpiTile
            key={estado}
            label={t(presentation.labelKey)}
            value={count}
            locale={locale}
            unit={count === 1 ? t('tracking.next.unitPlan') : t('tracking.next.unitPlans')}
            sub={
              <span className={count > 0 ? TONE_INK[presentation.tone] : 'text-fg-label'} data-state={presentation.countKey}>
                {count > 0 && nodoNames.length > 0
                  ? t('tracking.next.joined', { first: definition, second: joinNames(nodoNames, locale) })
                  : definition}
              </span>
            }
          />
        )
      })}
    </KpiRow>
  )
}

function CoverageLine({
  rows,
  directory,
  t,
  locale,
}: {
  rows: readonly ListRow[]
  directory: readonly { id: string; name: string }[] | null
  t: TranslateFn
  locale: string
}) {
  const reading = coverage(rows, directory)
  const head =
    reading.nodosTotal === null
      ? t(reading.plans === 1 ? 'tracking.next.planesCoverageBareOne' : 'tracking.next.planesCoverageBare', {
          plans: reading.plans,
          with: reading.nodosWith,
        })
      : t(reading.plans === 1 ? 'tracking.next.planesCoverageOne' : 'tracking.next.planesCoverage', {
          plans: reading.plans,
          with: reading.nodosWith,
          total: reading.nodosTotal,
        })
  const tail = reading.nodosTotal === null ? null : reading.without.length === 0 ? t('tracking.next.planesAllCovered') : t('tracking.next.planesWithout', { names: joinNames(reading.without, locale) })
  return <span>{tail ? t('tracking.next.joined', { first: head, second: tail }) : head}</span>
}

function Filters({
  nodo,
  estado,
  nodoOptions,
  onNodo,
  onEstado,
  summary,
  t,
}: {
  nodo: string
  estado: string
  nodoOptions: readonly { id: string; name: string }[]
  onNodo: (value: string) => void
  onEstado: (value: string) => void
  summary: ReactNode
  t: TranslateFn
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {nodoOptions.length > 1 && (
        <label className="m-0">
          <span className="sr-only">{t('tracking.next.planesNodoFilter')}</span>
          <CanvasSelect className="w-50" value={nodo} onChange={(event) => onNodo(event.target.value)}>
            <option value={ALL}>{t('tracking.next.planesAllNodos')}</option>
            {nodoOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </CanvasSelect>
        </label>
      )}
      <label className="m-0">
        <span className="sr-only">{t('tracking.next.planesEstadoFilter')}</span>
        <CanvasSelect className="w-50" value={estado} onChange={(event) => onEstado(event.target.value)}>
          <option value={ALL}>{t('tracking.filters.allStates')}</option>
          {SEMAFORO_ORDER.map((key) => (
            <option key={key} value={key}>
              {t(semaforoPresentation(key).labelKey)}
            </option>
          ))}
        </CanvasSelect>
      </label>
      <span className="text-xs text-fg-label sm:ml-auto">{summary}</span>
    </div>
  )
}

function SectionHead({ id, icon, tone, heading, count, note }: { id: string; icon: ReactNode; tone: string; heading: string; count: number; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div className="flex items-center gap-2.5">
        <span className={cn('inline-flex self-center', TONE_INK[tone] ?? 'text-fg-secondary')}>{icon}</span>
        <h2 id={id} className="m-0 text-2xl">
          {heading}
        </h2>
        <span className="font-mono text-xs tabular-nums text-fg-label">{count}</span>
      </div>
      <span className="text-xs text-fg-label sm:text-right">{note}</span>
    </div>
  )
}

function StateSection({ estado, rows, t, locale }: { estado: SemaforoEstado; rows: readonly ListRow[]; t: TranslateFn; locale: string }) {
  const presentation = semaforoPresentation(estado)
  const id = `planes-${presentation.countKey}`
  return (
    <section aria-labelledby={id} data-estado={estado} className="flex flex-col gap-2.5">
      <SectionHead id={id} icon={STATE_ICON[estado]} tone={presentation.tone} heading={t(presentation.labelKey)} count={rows.length} note={t(SECTION_NOTE[estado])} />
      {rows.length === 0 ? (
        <p className="m-0 flex items-start gap-2 rounded-lg border border-line-default bg-surface-card px-3.5 py-3 text-sm text-fg-secondary">
          <Clock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-fg-label" />
          {t(SECTION_EMPTY[estado])}
        </p>
      ) : (
        <PlansTable rows={rows} label={t(presentation.labelKey)} t={t} locale={locale} />
      )}
    </section>
  )
}

function UnknownSection({ rows, t, locale }: { rows: readonly ListRow[]; t: TranslateFn; locale: string }) {
  return (
    <section aria-labelledby="planes-sin-estado" className="flex flex-col gap-2.5">
      <SectionHead id="planes-sin-estado" icon={<CircleAlert aria-hidden="true" className="size-4" />} tone="" heading={t('tracking.next.planesSinEstado')} count={rows.length} note={t('tracking.next.planesSinEstadoNote')} />
      <PlansTable rows={rows} label={t('tracking.next.planesSinEstado')} t={t} locale={locale} />
    </section>
  )
}

function PlansTable({ rows, label, t, locale }: { rows: readonly ListRow[]; label: string; t: TranslateFn; locale: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line-default bg-surface-card shadow-sm">
      <div className="overflow-x-auto">
        {/* The six fixed columns take 54rem; the minimum leaves "Qué se hará" ~14rem at any width.
            At 1024 the table scrolls inside this container rather than crushing that column. */}
        <div className="min-w-[68rem] [&_[data-slot=table-container]]:overflow-visible">
          <Table aria-label={label} className="table-fixed">
            <colgroup>
              <col className="w-36" />
              <col />
              <col className="w-28" />
              <col className="w-48" />
              <col className="w-28" />
              <col className="w-36" />
              <col className="w-40" />
            </colgroup>
            <thead>
              <tr className="border-b border-line-default">
                <th className={TH}>{t('tracking.next.planesColCodigo')}</th>
                <th className={TH}>{t('tracking.next.planesColQue')}</th>
                <th className={TH}>{t('tracking.next.planesColNodo')}</th>
                <th className={TH}>{t('tracking.next.planesColResponsable')}</th>
                <th className={TH}>{t('tracking.next.planesColAvance')}</th>
                <th className={TH}>{t('tracking.next.planesColCompromiso')}</th>
                <th className={TH}>
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PlanRow key={row.id} row={row} t={t} locale={locale} />
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  )
}

function compromisoSub(row: ListRow, t: TranslateFn): string {
  const days = row.daysToCompromiso
  if (row.overdue) return days === -1 ? t('tracking.next.planesOverdueOne') : t('tracking.next.overdueBy', { days: Math.abs(days) })
  if (days === 0) return t('tracking.next.planesDueToday')
  if (days === 1) return t('tracking.next.planesInOneDay')
  return t('tracking.next.planesInDays', { days })
}

function PlanRow({ row, t, locale }: { row: ListRow; t: TranslateFn; locale: string }) {
  const responsable = row.responsable
  return (
    <tr data-plan-code={row.code} className="border-b border-line-light last:border-b-0">
      <td className="px-3 py-3 align-middle">
        <Link to={`/tracking/planes/${row.id}`} className="font-mono text-xs text-fg-secondary underline decoration-line-hover underline-offset-4">
          {row.code}
        </Link>
      </td>
      <td className="px-3 py-3 align-middle">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold text-fg-primary">{row.que}</span>
          {row.como && <span className="line-clamp-2 text-xs text-fg-label">{row.como}</span>}
        </span>
      </td>
      <td className="px-3 py-3 align-middle text-sm text-fg-secondary">{row.nodoName ?? t('tracking.next.nodoUnnamed')}</td>
      <td className="px-3 py-3 align-middle">
        {responsable.id === '' ? (
          <span className="text-xs text-fg-label">{t('tracking.next.responsableUnassigned')}</span>
        ) : responsable.name ? (
          <span className="flex min-w-0 items-center gap-2">
            <PersonaAvatar name={responsable.name} size="sm" />
            <span className="truncate text-sm text-fg-primary">{responsable.name}</span>
            {row.responsableIsViewer && <span className="shrink-0 text-xs text-fg-label">{t('tracking.next.planesYou')}</span>}
          </span>
        ) : (
          <span className="text-xs text-fg-label">{t('tracking.next.responsableUnnamed')}</span>
        )}
      </td>
      <td className="px-3 py-3 align-middle">
        <span className="flex flex-col gap-1.5">
          <span className="font-mono text-xs tabular-nums text-fg-primary">{t('tracking.next.planesPercent', { value: row.percent })}</span>
          <ProgressTrack percent={row.percent} overdue={row.overdue} label={t('tracking.next.planesPercent', { value: row.percent })} />
        </span>
      </td>
      <td className="px-3 py-3 align-middle">
        <span className="flex flex-col gap-0.5">
          <span className={cn('font-mono text-sm tabular-nums', row.overdue ? 'text-accent-red' : 'text-fg-primary')}>
            {calendarDay(Date.parse(`${row.fechaCompromiso}T00:00:00Z`), locale)}
          </span>
          <span className={cn('text-2xs', row.overdue ? 'text-accent-red' : 'text-fg-label')}>{compromisoSub(row, t)}</span>
        </span>
      </td>
      <td className="px-3 py-3 text-right align-middle">
        <Button asChild variant="outline">
          <Link to={`/tracking/planes/${row.id}`} aria-label={t('tracking.next.planesOpenNamed', { code: row.code })}>
            {row.canManage && row.estado === 'Rojo' ? t('tracking.next.planesRegistrarAvance') : t('tracking.next.planesAbrir')}
          </Link>
        </Button>
      </td>
    </tr>
  )
}

function Cumplidos({ rows, t, locale }: { rows: readonly ListRow[]; t: TranslateFn; locale: string }) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-labelledby="planes-cumplidos" className="flex flex-col gap-2.5">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        disabled={rows.length === 0}
        onClick={() => setOpen((value) => !value)}
        className="h-auto justify-start gap-2.5 rounded-xl border border-line-default bg-surface-card px-4 py-3 font-normal shadow-sm disabled:opacity-100"
      >
        <ChevronRight aria-hidden="true" className={cn('size-4 text-fg-label transition-transform', open && 'rotate-90')} />
        <span id="planes-cumplidos" className="text-sm font-semibold text-fg-primary">
          {t('tracking.next.planesCumplidos')}
        </span>
        <span className="font-mono text-xs tabular-nums text-fg-label">{rows.length}</span>
        <span className="text-xs text-fg-label">
          {rows.length === 0 ? t('tracking.next.planesCumplidosNone') : t('tracking.next.planesCumplidosSome')}
        </span>
      </Button>
      {open && rows.length > 0 && <PlansTable rows={rows} label={t('tracking.next.planesCumplidos')} t={t} locale={locale} />}
    </section>
  )
}

function Legend({ asOf, t, locale }: { asOf: string; t: TranslateFn; locale: string }) {
  return (
    <div className="grid grid-cols-1 items-start gap-x-6 gap-y-2 text-xs text-fg-secondary xl:grid-cols-[minmax(0,1fr)_auto]">
      <ul className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-2 p-0 md:grid-cols-3">
        {SEMAFORO_ORDER.map((estado) => {
          const presentation = semaforoPresentation(estado)
          return (
            <li key={estado} className="m-0 flex items-start gap-1.5">
              <span className={cn('mt-px inline-flex', TONE_INK[presentation.tone])}>{STATE_ICON[estado]}</span>
              <span>
                <b className="font-semibold text-fg-primary">{t(presentation.labelKey)}:</b> {t(LEGEND[estado])}
              </span>
            </li>
          )
        })}
      </ul>
      <span className="text-fg-label">{t('tracking.next.planesAsOf', { date: calendarDay(Date.parse(`${asOf}T00:00:00Z`), locale) })}</span>
    </div>
  )
}
