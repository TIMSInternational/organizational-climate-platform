import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Check, ChevronRight, CircleAlert, Clock, LayoutPanelTop, Plus, Shield, Users } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KpiTile } from '../../../components/charts'
import { Alert, AlertDescription, Button, Chip, EmptyState, LoadingRegion, NetworkError, SkeletonText, Table, chipVariants } from '../../../components/ui'
import { useCompanyName } from '../../../company-context/useCompanyName'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { KpiRow } from '../../dashboard/components/dashboardGrammar'
import { createPlanAccion, type CreatePlanAccionInput, type PlanAccion } from '../api/trackingApi'
import PlanDeAccionForm from '../components/PlanDeAccionForm'
import { SEMAFORO_ORDER, semaforoPresentation, type SemaforoEstado } from '../semaforo'
import { canCreatePlan, readTrackingClaims } from '../trackingAccess'
import { CanvasSelect, MiniBar } from '../../org-structure/next/super/parts'
import { joinNames } from './derive'
import { PersonaAvatar } from './parts'
import { coverage, groupRows, nodoNamesOf, toRows, type ListRow } from './planesList'
import { usePlanesListModel } from './usePlanesListModel'

const TH = 'h-auto bg-transparent px-1.5 pb-2 pt-2 first:pl-3 last:pr-3 text-2xs font-bold uppercase tracking-label text-fg-label whitespace-nowrap'
/**
 * The board's row is a grid with a 12px gap inside 12px of padding; 6px either side of a cell,
 * 12px at the row's two ends, keeps that rhythm, so the column widths are the board's own.
 */
const TD = 'px-1.5 py-3 align-middle first:pl-3 last:pr-3'
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
 * The leader board's "Alcance de la lista": the two relations a node leader has to the plans
 * `GET /api/planes-accion` returns them, and the union.
 *
 * Not a filter by nodo. `mine` is "the service lets me record avance here" (`canManage`) and
 * `involved` is "this plan names me" (`named`) — two different answers from
 * `PlanAccessHandler`, and a leader can hold both on the same plan, which is why `all` is not
 * the sum of the two.
 */
type Scope = 'all' | 'mine' | 'involved'

function inScope(row: ListRow, scope: Scope): boolean {
  if (scope === 'mine') return row.canManage
  if (scope === 'involved') return row.named && !row.canManage
  return true
}

function scopeCounts(rows: readonly ListRow[]): Record<Scope, number> {
  return {
    all: rows.length,
    mine: rows.filter((row) => inScope(row, 'mine')).length,
    involved: rows.filter((row) => inScope(row, 'involved')).length,
  }
}

const SCOPE_LABEL: Record<Scope, string> = {
  all: 'tracking.next.planesScopeAll',
  mine: 'tracking.next.planesScopeMine',
  involved: 'tracking.next.planesScopeInvolved',
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
 *
 * ## The node leader's board (TrackingPlanesListLeader, 10 Sep)
 *
 * A `leader` with a real `nodoId` (`capabilities.leadsANodo`) gets a different page from the
 * same data, because their list is not one thing: `PlanesAccionEndpoints` hands them their
 * OWN nodo's plans, where they record avance, **and** plans of other nodos that merely name
 * them, where they may not. An administrator filters by nodo because they have every nodo;
 * this reader has two relations to what they can see, and the board says so — in the
 * description, in a scope selector, in a "Tu papel" column in place of "Nodo", and in a
 * legend that spells out what each relation lets them do.
 *
 * "Marcar cumplido" is on neither relation. Since 2026-09-14 that is `AccessLevel.Approve`
 * and an administrator's act (`docs/decisions/tracking-fulfilment-authority.md`), so the
 * board's own sentence — which in the artboard read "registras avance y lo marcas cumplido"
 * — says the opposite here, deliberately.
 */
export default function PlanesListNextPage() {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const companyName = useCompanyName()
  const claims = useMemo(() => readTrackingClaims(), [])
  const state = usePlanesListModel()
  const [nodo, setNodo] = useState(ALL)
  const [scope, setScope] = useState<Scope>('all')
  const [estado, setEstado] = useState(ALL)
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [created, setCreated] = useState<PlanAccion | null>(null)
  const mayCreate = canCreatePlan(claims)
  /** The node leader's board: `role === 'leader'` with a `nodoId` that names a real nodo. */
  const leaderView = capabilities.leadsANodo
  const ownNodo = state.ownNodoName

  const names = useMemo(() => new Map((state.nodos ?? []).map((item) => [item.id, item.name])), [state.nodos])
  const rows = useMemo(
    () => toRows(state.plans, state.asOf, names, state.personas, state.viewer, claims),
    [state.plans, state.asOf, names, state.personas, state.viewer, claims],
  )
  const all = groupRows(rows)
  const filtered = rows.filter(
    (row) =>
      (nodo === ALL || row.nodoExternalId === nodo) &&
      (!leaderView || inScope(row, scope)) &&
      (estado === ALL || row.estado === estado),
  )
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
          eyebrow={
            leaderView && ownNodo
              ? t('tracking.next.planesEyebrowNodo', { nodo: ownNodo })
              : companyName
                ? t('tracking.next.consolidadoEyebrow', { company: companyName })
                : t('tracking.next.consolidadoEyebrowBare')
          }
          title={t('tracking.next.planesTitle')}
          description={
            leaderView
              ? ownNodo
                ? t('tracking.next.planesDescriptionLeader', { nodo: ownNodo })
                : t('tracking.next.planesDescriptionLeaderBare')
              : t('tracking.next.planesDescription')
          }
          // The board's dashed line under the description. It is not decoration: a leader
          // who presses "Nuevo plan" gets a form whose nodo field offers exactly one option
          // (`trackingAccess.creatableNodos`), and being told why beforehand is the whole
          // difference between a constraint and a bug.
          meta={
            leaderView && mayCreate ? (
              <span className="flex items-start gap-2 text-xs text-fg-label" data-slot="create-note">
                <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                <span>{ownNodo ? t('tracking.next.planesCreateNote', { nodo: ownNodo }) : t('tracking.next.planesCreateNoteBare')}</span>
              </span>
            ) : undefined
          }
          actions={
            capabilities.canViewConsolidado || capabilities.leadsANodo || mayCreate ? (
              <>
                {capabilities.canViewConsolidado && (
                  <Button asChild variant="outline">
                    <Link to="/tracking">
                      <LayoutPanelTop aria-hidden="true" />
                      {t('tracking.next.planesConsolidado')}
                    </Link>
                  </Button>
                )}
                {/* A leader has no consolidado — `ConsolidadoAsync` forbids them — and their
                    equivalent is their own nodo's board. `/tracking/tablero` takes no id:
                    `TableroAsync` answers a caller who names none with their own nodo. */}
                {leaderView && (
                  <Button asChild variant="outline">
                    <Link to="/tracking/tablero">
                      <LayoutPanelTop aria-hidden="true" />
                      {ownNodo ? t('tracking.next.planesTablero', { nodo: ownNodo }) : t('tracking.next.planesTableroBare')}
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
                    {leaderView && ownNodo ? t('tracking.next.planesNewPlanIn', { nodo: ownNodo }) : t('tracking.actions.newPlan')}
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
              <Tiles rows={rows} grouped={all} nodoOrder={nodoOrder} leaderView={leaderView} ownNodo={ownNodo} t={t} locale={locale} />

              <div className="flex flex-col gap-4">
                <Filters
                  nodo={nodo}
                  estado={estado}
                  nodoOptions={nodoOptions}
                  onNodo={setNodo}
                  onEstado={setEstado}
                  scope={leaderView ? scope : null}
                  scopeCounts={scopeCounts(rows)}
                  onScope={setScope}
                  summary={leaderView ? <span>{t('tracking.next.planesScopeNote')}</span> : <CoverageLine rows={rows} directory={state.nodos} t={t} locale={locale} />}
                  t={t}
                />
                {filtered.length === 0 ? (
                  <EmptyState title={t('tracking.next.planesFilterEmpty')} />
                ) : (
                  <>
                    {SEMAFORO_ORDER.filter((key) => estado === ALL || estado === key).map((key) => (
                      <StateSection key={key} estado={key} rows={shown.byEstado[key]} leaderView={leaderView} ownNodo={ownNodo} t={t} locale={locale} />
                    ))}
                    {shown.unknown.length > 0 && <UnknownSection rows={shown.unknown} leaderView={leaderView} ownNodo={ownNodo} t={t} locale={locale} />}
                  </>
                )}
                {estado === ALL && <Cumplidos rows={shown.cumplidos} leaderView={leaderView} ownNodo={ownNodo} t={t} locale={locale} />}
              </div>

              <Legend asOf={state.asOf} t={t} locale={locale} />
              {leaderView && <RoleLegend ownNodo={ownNodo} t={t} />}
              <div className="flex items-start gap-2.5 rounded-lg bg-surface-icon-box px-3.5 py-3 text-sm leading-normal text-fg-secondary">
                <Shield aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{leaderView ? t('tracking.next.planesWhoWritesLeader') : t('tracking.next.planesWhoWrites')}</span>
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
  leaderView,
  ownNodo,
  t,
  locale,
}: {
  rows: readonly ListRow[]
  grouped: ReturnType<typeof groupRows>
  nodoOrder: readonly string[]
  leaderView: boolean
  ownNodo: string | null
  t: TranslateFn
  locale: string
}) {
  const nodos = new Set(rows.map((row) => row.nodoExternalId)).size
  const withProgress = rows.filter((row) => row.hasProgress).length
  const cumplidos = grouped.cumplidos.length
  const counts = scopeCounts(rows)
  const sub = [
    withProgress === 0 ? t('tracking.next.planesNoneWithProgress') : t('tracking.next.planesWithProgress', { count: withProgress }),
    cumplidos === 0
      ? t('tracking.next.planesNoneCumplido')
      : cumplidos === 1
        ? t('tracking.next.planesCumplidoOne')
        : t('tracking.next.planesCumplidoMany', { count: cumplidos }),
  ].join(' · ')
  // "in 2 nodos" is a coverage reading, and coverage is a statement about the tenant that
  // only a reader who can see the tenant may make. A leader sees their own nodo plus
  // whatever named them, so the board splits the total that way instead.
  const leaderSub = t('tracking.next.joined', {
    first: ownNodo ? t('tracking.next.planesFromYourNodo', { nodo: ownNodo }) : t('tracking.next.planesFromYourNodoBare'),
    second: counts.involved === 0 ? t('tracking.next.planesNoneOtherNodos') : t('tracking.next.planesOtherNodos', { count: counts.involved }),
  })
  return (
    <KpiRow>
      <KpiTile
        label={leaderView ? t('tracking.next.planesTileYours') : t('tracking.totalPlanes')}
        value={rows.length}
        locale={locale}
        unit={
          leaderView
            ? rows.length === 1
              ? t('tracking.next.unitPlan')
              : t('tracking.next.unitPlans')
            : nodos === 1
              ? t('tracking.next.inOneNodo')
              : t('tracking.next.inNodos', { count: nodos })
        }
        sub={<span className="text-fg-label">{leaderView ? leaderSub : sub}</span>}
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
  scope,
  scopeCounts: counts,
  onScope,
  summary,
  t,
}: {
  nodo: string
  estado: string
  nodoOptions: readonly { id: string; name: string }[]
  onNodo: (value: string) => void
  onEstado: (value: string) => void
  /** `null` for everyone but the node leader, whose board replaces the nodo picker with it. */
  scope: Scope | null
  scopeCounts: Record<Scope, number>
  onScope: (value: Scope) => void
  summary: ReactNode
  t: TranslateFn
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {scope !== null ? (
        // Toggle buttons in a named group, not `role="tab"`: these filter a list that is
        // already on screen, and a tab whose panel is the page would be claiming a
        // relationship the markup does not have. `chipVariants` styles them whole, so
        // `index.css`'s bare-button card never shows (`SurveysListNextPage` does the same).
        <div role="group" aria-label={t('tracking.next.planesScopeLabel')} className="flex flex-wrap items-center gap-1.5">
          {(['all', 'mine', 'involved'] as const).map((value) => {
            const selected = scope === value
            return (
              <button
                key={value}
                type="button"
                data-slot="scope-pill"
                data-scope={value}
                aria-pressed={selected}
                onClick={() => onScope(value)}
                className={cn(chipVariants({ tone: selected ? 'critical' : 'neutral' }), 'cursor-pointer hover:border-line-hover')}
              >
                {t(SCOPE_LABEL[value])}
                <span className="font-mono tabular-nums">{counts[value]}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {scope === null && nodoOptions.length > 1 && (
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

function StateSection({
  estado,
  rows,
  leaderView,
  ownNodo,
  t,
  locale,
}: {
  estado: SemaforoEstado
  rows: readonly ListRow[]
  leaderView: boolean
  ownNodo: string | null
  t: TranslateFn
  locale: string
}) {
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
        <PlansTable rows={rows} label={t(presentation.labelKey)} leaderView={leaderView} ownNodo={ownNodo} t={t} locale={locale} />
      )}
    </section>
  )
}

function UnknownSection({
  rows,
  leaderView,
  ownNodo,
  t,
  locale,
}: {
  rows: readonly ListRow[]
  leaderView: boolean
  ownNodo: string | null
  t: TranslateFn
  locale: string
}) {
  return (
    <section aria-labelledby="planes-sin-estado" className="flex flex-col gap-2.5">
      <SectionHead id="planes-sin-estado" icon={<CircleAlert aria-hidden="true" className="size-4" />} tone="" heading={t('tracking.next.planesSinEstado')} count={rows.length} note={t('tracking.next.planesSinEstadoNote')} />
      <PlansTable rows={rows} label={t('tracking.next.planesSinEstado')} leaderView={leaderView} ownNodo={ownNodo} t={t} locale={locale} />
    </section>
  )
}

function PlansTable({
  rows,
  label,
  leaderView,
  ownNodo,
  t,
  locale,
}: {
  rows: readonly ListRow[]
  label: string
  leaderView: boolean
  ownNodo: string | null
  t: TranslateFn
  locale: string
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line-default bg-surface-card shadow-sm">
      <div className="overflow-x-auto">
        {/* The six fixed columns are the board's 124 / 100 / 170 / 96 / 136 / 136px, each with its
            share of the gap, so "Qué se hará" gets the board's ~286px at 1440 and a title sets on
            one line. The minimum leaves that column ~15rem; at 1024 the table scrolls inside this
            container rather than crushing it. */}
        <div className="min-w-[68rem] [&_[data-slot=table-container]]:overflow-visible">
          <Table aria-label={label} className="table-fixed">
            <colgroup>
              <col className="w-35.5" />
              <col />
              <col className={leaderView ? 'w-38' : 'w-28'} />
              <col className="w-45.5" />
              <col className="w-27" />
              <col className="w-37" />
              <col className="w-38.5" />
            </colgroup>
            <thead>
              <tr className="border-b border-line-default">
                <th className={TH}>{t('tracking.next.planesColCodigo')}</th>
                <th className={TH}>{t('tracking.next.planesColQue')}</th>
                {/* The leader board replaces "Nodo" with "Tu papel". A leader's list holds
                    at most their own nodo plus whichever ones named them, so the nodo's name
                    is the less useful half of that cell — and the half they cannot resolve
                    anyway for a plan that is not theirs (`TrackingPickerEndpoints.cs:19-21`). */}
                <th className={TH}>{leaderView ? t('tracking.next.planesColPapel') : t('tracking.next.planesColNodo')}</th>
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
                <PlanRow key={row.id} row={row} leaderView={leaderView} ownNodo={ownNodo} t={t} locale={locale} />
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

function PlanRow({
  row,
  leaderView,
  ownNodo,
  t,
  locale,
}: {
  row: ListRow
  leaderView: boolean
  ownNodo: string | null
  t: TranslateFn
  locale: string
}) {
  const responsable = row.responsable
  return (
    <tr data-plan-code={row.code} className="border-b border-line-light last:border-b-0">
      <td className={TD}>
        <Link to={`/tracking/planes/${row.id}`} className="font-mono text-xs text-fg-secondary underline decoration-line-hover underline-offset-4">
          {row.code}
        </Link>
      </td>
      <td className={TD}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold text-fg-primary">{row.que}</span>
          {row.como && <span className="line-clamp-2 text-xs text-fg-label">{row.como}</span>}
        </span>
      </td>
      {leaderView ? (
        <td className={TD} data-slot="papel">
          <span className="flex min-w-0 flex-col gap-1">
            <Chip
              label={row.canManage ? t('tracking.next.planesPapelTuNodo') : t('tracking.next.planesPapelParticipas')}
              icon={row.canManage ? <LayoutPanelTop /> : <Users />}
            />
            <span className="text-2xs text-fg-label">
              {row.canManage
                ? row.nodoName ?? ownNodo
                  ? t('tracking.next.planesPapelRegistras', { nodo: row.nodoName ?? ownNodo ?? '' })
                  : t('tracking.next.planesPapelRegistrasBare')
                : t('tracking.next.planesPapelOtroNodo')}
            </span>
          </span>
        </td>
      ) : (
        <td className={cn(TD, 'text-sm text-fg-secondary')}>{row.nodoName ?? t('tracking.next.nodoUnnamed')}</td>
      )}
      <td className={TD}>
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
      <td className={TD}>
        {/* The list's thin 72px bar, as the board draws it here: the reading only. The compromiso
            mark at the end of the detail's track (`ProgressTrack`) belongs to that screen, and the
            printed percentage above is what a reader or a screen reader takes from this cell. */}
        <span className="flex flex-col gap-1.5" data-slot="avance">
          <span className="font-mono text-sm tabular-nums text-fg-primary">{t('tracking.next.planesPercent', { value: row.percent })}</span>
          <MiniBar percent={row.percent} className="w-18" />
        </span>
      </td>
      <td className={TD}>
        <span className="flex flex-col gap-0.5">
          <span className={cn('font-mono text-sm tabular-nums', row.overdue ? 'text-accent-red' : 'text-fg-primary')}>
            {calendarDay(Date.parse(`${row.fechaCompromiso}T00:00:00Z`), locale)}
          </span>
          <span className={cn('text-2xs', row.overdue ? 'text-accent-red' : 'text-fg-label')}>{compromisoSub(row, t)}</span>
        </span>
      </td>
      <td className={cn(TD, 'text-right')}>
        <Button asChild variant="outline">
          <Link to={`/tracking/planes/${row.id}`} aria-label={t('tracking.next.planesOpenNamed', { code: row.code })}>
            {row.canManage && row.estado === 'Rojo' ? t('tracking.next.planesRegistrarAvance') : t('tracking.next.planesAbrir')}
          </Link>
        </Button>
      </td>
    </tr>
  )
}

function Cumplidos({
  rows,
  leaderView,
  ownNodo,
  t,
  locale,
}: {
  rows: readonly ListRow[]
  leaderView: boolean
  ownNodo: string | null
  t: TranslateFn
  locale: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <section aria-labelledby="planes-cumplidos" className="flex flex-col gap-2.5">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        disabled={rows.length === 0}
        onClick={() => setOpen((value) => !value)}
        // `flex-wrap` and a text column that may shrink: the leader's line names the nodo
        // ("ningún plan de Ingeniería se ha marcado como cumplido todavía") and at 390 the
        // row ran past the card's right edge and was clipped. Only the PNG showed it.
        className="h-auto flex-wrap justify-start gap-x-2.5 gap-y-1 whitespace-normal rounded-xl border border-line-default bg-surface-card px-4 py-3 text-left font-normal shadow-sm disabled:opacity-100"
      >
        <ChevronRight aria-hidden="true" className={cn('size-4 text-fg-label transition-transform', open && 'rotate-90')} />
        <span id="planes-cumplidos" className="text-sm font-semibold text-fg-primary">
          {t('tracking.next.planesCumplidos')}
        </span>
        <span className="font-mono text-xs tabular-nums text-fg-label">{rows.length}</span>
        <span className="min-w-0 text-xs text-fg-label">
          {rows.length === 0
            ? leaderView && ownNodo
              ? t('tracking.next.planesCumplidosNoneNodo', { nodo: ownNodo })
              : t('tracking.next.planesCumplidosNone')
            : t('tracking.next.planesCumplidosSome')}
        </span>
      </Button>
      {open && rows.length > 0 && (
        <PlansTable rows={rows} label={t('tracking.next.planesCumplidos')} leaderView={leaderView} ownNodo={ownNodo} t={t} locale={locale} />
      )}
    </section>
  )
}

/**
 * The leader board's closing block: what each of the two marks in the "Tu papel" column
 * actually lets the reader do.
 *
 * The artboard's first line reads "el plan es de Ingeniería: registras avance **y lo marcas
 * cumplido**". That half is no longer true — `POST …/cumplir` became `AccessLevel.Approve` on
 * 2026-09-14 and `PlanAccessHandler` excludes the node's own leader from it by name — so the
 * line says who does instead. Reported as a difference from the board rather than built.
 */
function RoleLegend({ ownNodo, t }: { ownNodo: string | null; t: TranslateFn }) {
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 text-xs text-fg-secondary md:grid-cols-2" data-slot="role-legend">
      {/* `items-start` + a `min-w-0 flex-1` text column, not `flex-wrap`: wrapping put the
          chip on its own line for whichever item happened to be longer, so the two halves of
          one legend lined up differently. Only the PNG showed it. */}
      <li className="m-0 flex items-start gap-2">
        <Chip label={t('tracking.next.planesPapelTuNodo')} icon={<LayoutPanelTop />} />
        <span className="min-w-0 flex-1 pt-0.5">
          {ownNodo ? t('tracking.next.planesRoleLegendMine', { nodo: ownNodo }) : t('tracking.next.planesRoleLegendMineBare')}
        </span>
      </li>
      {/* `items-start` + a `min-w-0 flex-1` text column, not `flex-wrap`: wrapping put the
          chip on its own line for whichever item happened to be longer, so the two halves of
          one legend lined up differently. Only the PNG showed it. */}
      <li className="m-0 flex items-start gap-2">
        <Chip label={t('tracking.next.planesPapelParticipas')} icon={<Users />} />
        <span className="min-w-0 flex-1 pt-0.5">{t('tracking.next.planesRoleLegendInvolved')}</span>
      </li>
    </ul>
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
