import { useState } from 'react'
import { Link } from 'react-router'
import { CalendarDays, CircleDot, Download } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { KpiTile } from '../../../components/charts'
import { Alert, AlertDescription, Button, EmptyState, ErrorState, LoadingRegion, NetworkError, SkeletonText, Table } from '../../../components/ui'
import { useCompanyName } from '../../../company-context/useCompanyName'
import { calendarDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import { KpiRow } from '../../dashboard/components/dashboardGrammar'
import { downloadBlobFile } from '../../../lib/downloadBlobFile'
import { exportPlanesAccionSheet, trackingSheetFileName, type SemaforoCounts } from '../api/trackingApi'
import SemaforoChip, { SemaforoGlyph } from '../components/SemaforoChip'
import { SEMAFORO_ORDER, semaforoCount, semaforoPresentation, type SemaforoEstado } from '../semaforo'
import { todayIso } from '../planDates'
import { percentagePoints } from '../trackingUnits'
import { joinNames, nodosIn } from './derive'
import type { ConsolidadoModel, NodoBlock, PlanLine } from './model'
import { useConsolidadoModel } from './useConsolidadoModel'

const HEAD = 'h-auto bg-transparent px-3 pb-2 pt-0 text-2xs font-bold uppercase tracking-label text-fg-label whitespace-nowrap'

/** The ink a state's figures and sentences take — the chip carries the word and shape. */
const TONE_INK: Record<string, string> = {
  critical: 'text-accent-red',
  warning: 'text-accent-amber-ink',
  good: 'text-accent-green-ink',
}

/** The line under each state's tile, in the artboard's lower case. */
const TILE_SUB: Record<keyof SemaforoCounts, string> = {
  rojo: 'tracking.next.subRojo',
  amarillo: 'tracking.next.subAmarillo',
  verde: 'tracking.next.subVerde',
}

/**
 * `/tracking` — the redesigned Vista Consolidada, the TrackingConsolidado artboard of
 * 10 Sep. It replaced `pages/ConsolidadoPage.tsx` on this route; that page stays in the
 * tree, unrouted, as the wiring reference.
 *
 * Summary first — how many plans, and how many in each state of the semáforo, naming the
 * nodos behind each — then the sheet itself: one block per nodo with its counts and its
 * plans, "tal como se exporta". The prior-year column the sheet will carry is hidden with
 * one sentence until a prior period is linked: absent is not zero, and a column of dashes
 * would read as one.
 *
 * ## Roles
 *
 * Administrators only — `canViewConsolidado` in the seam, which mirrors
 * `ConsolidadoAsync`'s `Results.Forbid()` and the tenant gate. Anyone else is told whose
 * screen this is and no request is made.
 *
 * ## "Exportar hoja"
 *
 * The client's own workbook from the tracking service (`GET /api/planes-accion/export`,
 * `TrackingSheetExportEndpoints.cs:27`), through `exportPlanesAccionSheet`: an authorized
 * `fetch` read into a `Blob` and handed to the browser as a file. The sheet holds the plans
 * the listing would show this caller and nothing more (the endpoint's `Visible` predicate).
 * A failed download says so above the page rather than leaving the click unanswered.
 */
export default function ConsolidadoNextPage() {
  const { t, locale } = useTranslation()
  const companyName = useCompanyName()
  const state = useConsolidadoModel()
  const [exporting, setExporting] = useState(false)
  const [exportFailed, setExportFailed] = useState(false)

  async function exportSheet() {
    setExporting(true)
    setExportFailed(false)
    try {
      downloadBlobFile(trackingSheetFileName(todayIso()), await exportPlanesAccionSheet())
    } catch {
      setExportFailed(true)
    } finally {
      setExporting(false)
    }
  }

  if (state.status === 'restricted') {
    return <ErrorState title={t('tracking.consolidadoRestrictedTitle')} description={t('tracking.consolidadoRestrictedBody')} />
  }

  const { model } = state
  return (
    <div>
      <PageTopBar
        eyebrow={
          companyName ? t('tracking.next.consolidadoEyebrow', { company: companyName }) : t('tracking.next.consolidadoEyebrowBare')
        }
        title={t('tracking.consolidadoTitle')}
        description={t('tracking.consolidadoDescription')}
        actions={
          <>
            <Button type="button" variant="outline" disabled={exporting} aria-busy={exporting || undefined} onClick={() => void exportSheet()}>
              <Download aria-hidden="true" />
              {exporting ? t('tracking.next.exporting') : t('tracking.next.exportSheet')}
            </Button>
            <Button asChild variant="outline">
              <Link to="/tracking/planes">
                <CircleDot aria-hidden="true" />
                {t('tracking.next.viewPlans')}
              </Link>
            </Button>
          </>
        }
      />

      {exportFailed && (
        <Alert variant="destructive" className="mb-panel-gap">
          <AlertDescription>{t('tracking.next.exportFailed')}</AlertDescription>
        </Alert>
      )}

      {state.status === 'error' ? (
        <NetworkError
          title={t('tracking.serviceUnavailableTitle')}
          description={t('tracking.serviceUnavailableBody')}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' || !model ? (
            <SkeletonText lines={6} />
          ) : model.nodos.length === 0 ? (
            <EmptyState fill title={t('tracking.consolidadoEmptyTitle')} description={t('tracking.consolidadoEmptyBody')} />
          ) : (
            <div className="flex flex-col gap-section">
              <Tiles model={model} t={t} locale={locale} />
              <ByNodo model={model} t={t} locale={locale} />
              {model.nodos.every((nodo) => percentagePoints(nodo.resultadoAnioAnteriorPct) === null) && (
                <p className="m-0 flex items-start gap-2.5 rounded-md bg-surface-icon-box px-3.5 py-3 text-xs text-fg-secondary">
                  <CalendarDays aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                  <span>{t('tracking.next.priorYearHidden', { year: Number(model.asOf.slice(0, 4)) - 1 })}</span>
                </p>
              )}
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

function Tiles({ model, t, locale }: { model: ConsolidadoModel; t: TranslateFn; locale: string }) {
  const total = model.nodos.reduce((sum, nodo) => sum + nodo.totalPlanes, 0)
  const nodosWithPlans = model.nodos.filter((nodo) => nodo.totalPlanes > 0)
  const everyPlan = model.nodos.flatMap((nodo) => nodo.plans ?? [])
  const plansKnown = model.nodos.every((nodo) => nodo.plans !== null)
  const withProgress = everyPlan.filter((plan) => plan.percent > 0).length
  const parts: string[] = []
  if (nodosWithPlans.length > 0 && nodosWithPlans.every((nodo) => nodo.totalPlanes === 1)) parts.push(t('tracking.next.onePerNodo'))
  if (plansKnown && total > 0) {
    parts.push(withProgress === 0 ? t('tracking.next.noneWithProgress') : t('tracking.next.withProgress', { count: withProgress }))
  }

  return (
    <KpiRow>
      <KpiTile
        label={t('tracking.totalPlanes')}
        value={total}
        locale={locale}
        unit={
          nodosWithPlans.length === 1
            ? t('tracking.next.inOneNodo')
            : t('tracking.next.inNodos', { count: nodosWithPlans.length })
        }
        sub={parts.length > 0 ? <span className="text-fg-label">{parts.join(' · ')}</span> : undefined}
      />
      {SEMAFORO_ORDER.map((estado) => (
        <StateTile key={estado} estado={estado} model={model} t={t} locale={locale} />
      ))}
    </KpiRow>
  )
}

function StateTile({ estado, model, t, locale }: { estado: SemaforoEstado; model: ConsolidadoModel; t: TranslateFn; locale: string }) {
  const presentation = semaforoPresentation(estado)
  const count = semaforoCount(model.conteos, estado)
  const names = nodosIn(model.nodos, estado)
  const sub = t(TILE_SUB[presentation.countKey])
  return (
    <KpiTile
      label={t(presentation.labelKey)}
      value={count}
      locale={locale}
      unit={count === 1 ? t('tracking.next.unitPlan') : t('tracking.next.unitPlans')}
      aside={<SemaforoChip estado={estado} />}
      sub={
        <span className={count > 0 ? TONE_INK[presentation.tone] : 'text-fg-label'} data-state={presentation.countKey}>
          {count > 0 && names.length > 0 ? t('tracking.next.joined', { first: sub, second: joinNames(names, locale) }) : sub}
        </span>
      }
    />
  )
}

function ByNodo({ model, t, locale }: { model: ConsolidadoModel; t: TranslateFn; locale: string }) {
  const total = model.nodos.reduce((sum, nodo) => sum + nodo.totalPlanes, 0)
  const withPlans = model.nodos.filter((nodo) => nodo.totalPlanes > 0).length
  const withoutPlans = model.directoryNodoCount === null ? null : Math.max(0, model.directoryNodoCount - withPlans)
  const consulted = new Date(model.consultedAt)

  return (
    <section aria-labelledby="consolidado-por-nodo" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 id="consolidado-por-nodo" className="m-0">
            {t('tracking.next.byNodoHeading')}
          </h2>
          <span className="font-mono text-xs text-fg-label tabular-nums">
            {t('tracking.next.byNodoCount', { nodos: model.nodos.length, planes: total })}
          </span>
        </div>
        <p className="m-0 text-xs text-fg-label">{t('tracking.next.byNodoNote')}</p>
      </div>

      <div className="rounded-lg border border-line-default bg-surface-card pt-2 shadow-sm">
        <Table className="min-w-[1000px] table-fixed">
          <colgroup>
            <col className="w-[162px]" />
            <col className="w-[68px]" />
            <col className="w-[92px]" />
            <col className="w-[92px]" />
            <col className="w-[92px]" />
            <col />
            <col className="w-[142px]" />
            <col className="w-[136px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-line-default">
              <th className={HEAD}>{t('tracking.next.colNodoPlan')}</th>
              <th className={cn(HEAD, 'text-right')}>{t('tracking.columnTotalPlanes')}</th>
              {SEMAFORO_ORDER.map((estado) => (
                <th key={estado} className={cn(HEAD, 'text-center')}>
                  {t(semaforoPresentation(estado).labelKey)}
                </th>
              ))}
              <th className={HEAD}>{t('tracking.next.colQue')}</th>
              <th className={HEAD}>{t('tracking.columnAvance')}</th>
              <th className={HEAD}>{t('tracking.next.colCompromiso')}</th>
            </tr>
          </thead>
          {model.nodos.map((nodo) => (
            <NodoRows key={nodo.nodoExternalId} nodo={nodo} t={t} locale={locale} />
          ))}
          <tfoot>
            <tr className="border-t border-line-default">
              <th scope="row" className="border-0 px-3 py-2.5 text-left text-base font-semibold text-fg-primary">
                {t('tracking.next.total')}
              </th>
              <td className="border-0 px-3 py-2.5 text-right font-mono tabular-nums text-fg-primary">{total}</td>
              {SEMAFORO_ORDER.map((estado) => (
                <CountCell key={estado} estado={estado} counts={model.conteos} />
              ))}
              <td colSpan={3} className="border-0 px-3 py-2.5 text-xs text-fg-label">
                {withoutPlans === null
                  ? t('tracking.next.nodosWithPlans', { count: withPlans })
                  : t('tracking.next.nodosWithAndWithout', { with: withPlans, without: withoutPlans })}
              </td>
            </tr>
          </tfoot>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {SEMAFORO_ORDER.map((estado) => {
          const presentation = semaforoPresentation(estado)
          return (
            <span key={estado} className="inline-flex items-center gap-1.5 text-xs text-fg-label">
              <SemaforoGlyph estado={estado} className={cn('size-3.5', TONE_INK[presentation.tone])} />
              {t('tracking.next.legendItem', { state: t(presentation.labelKey), meaning: t(TILE_SUB[presentation.countKey]) })}
            </span>
          )
        })}
        <span className="ml-auto text-xs text-fg-label">
          {t('tracking.next.consultedAt', {
            date: calendarDay(Date.parse(model.asOf), locale),
            time: consulted.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
          })}
        </span>
      </div>
    </section>
  )
}

function CountCell({ estado, counts }: { estado: SemaforoEstado; counts: SemaforoCounts }) {
  const count = semaforoCount(counts, estado)
  const presentation = semaforoPresentation(estado)
  return (
    <td
      className={cn(
        'border-0 px-3 py-2.5 text-center font-mono tabular-nums',
        count > 0 ? TONE_INK[presentation.tone] : 'text-fg-label',
      )}
    >
      {count}
    </td>
  )
}

function NodoRows({ nodo, t, locale }: { nodo: NodoBlock; t: TranslateFn; locale: string }) {
  return (
    <tbody data-nodo={nodo.nodoExternalId}>
      <tr className="border-b border-line-default bg-surface-outer">
        <th scope="rowgroup" className="border-0 px-3 py-2 text-left">
          {/* The drill-in, and the deepest this screen goes: one nodo's aggregate board.
              Never a person, never an answer. */}
          <Link
            to={`/tracking/tablero?nodoId=${encodeURIComponent(nodo.nodoExternalId)}`}
            className={cn('text-base font-semibold text-fg-primary no-underline hover:underline', !nodo.name && 'font-mono text-xs')}
          >
            {nodo.name ?? nodo.nodoExternalId}
          </Link>
        </th>
        <td className="border-0 px-3 py-2 text-right font-mono tabular-nums text-fg-primary">{nodo.totalPlanes}</td>
        {SEMAFORO_ORDER.map((estado) => (
          <CountCell key={estado} estado={estado} counts={nodo.conteos} />
        ))}
        <td className="border-0" colSpan={3} />
      </tr>
      {nodo.plans === null ? (
        <tr className="border-b border-line-light">
          <td colSpan={8} className="border-0 px-3 py-2.5 pl-7 text-xs text-fg-secondary">
            {t('tracking.next.plansUnavailable')}
          </td>
        </tr>
      ) : (
        nodo.plans.map((plan) => <PlanRow key={plan.id} plan={plan} t={t} locale={locale} />)
      )}
    </tbody>
  )
}

function PlanRow({ plan, t, locale }: { plan: PlanLine; t: TranslateFn; locale: string }) {
  const overdue = !plan.cumplido && plan.daysToCompromiso < 0
  return (
    <tr className="border-b border-line-light" data-plan={plan.code}>
      <td className="border-0 py-2.5 pl-7 pr-3">
        <Link
          to={`/tracking/planes/${plan.id}`}
          className="rounded-sm bg-surface-icon-box px-1.5 py-px font-mono text-xs text-fg-secondary no-underline hover:underline"
        >
          {plan.code}
        </Link>
      </td>
      <td className="border-0" colSpan={4} />
      <td className="border-0 px-3 py-2.5">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-base text-fg-primary">{plan.que}</span>
          <span className="text-xs text-fg-label">
            {plan.responsable.name
              ? t('tracking.next.responsableNamed', { name: plan.responsable.name })
              : plan.responsable.id === ''
                ? t('tracking.next.responsableUnassigned')
                : t('tracking.next.responsableUnnamed')}
          </span>
        </div>
      </td>
      <td className="border-0 px-3 py-2.5">
        <div className="flex flex-col gap-1">
          <SemaforoChip estado={plan.estado} className="w-full" />
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-icon-box">
              <span
                className={cn('h-full rounded-full', overdue ? 'bg-accent-red' : 'bg-accent-green')}
                style={{ width: `${plan.percent}%` }}
              />
            </span>
            <span className="font-mono text-xs text-fg-secondary tabular-nums">{t('tracking.next.percentBig', { percent: plan.percent })}</span>
          </div>
        </div>
      </td>
      <td className="border-0 px-3 py-2.5">
        <div className="flex flex-col">
          <span className={cn('font-mono text-sm tabular-nums', overdue ? 'text-accent-red' : 'text-fg-primary')}>
            {calendarDay(Date.parse(plan.fechaCompromiso), locale)}
          </span>
          <span className={cn('text-xs', overdue ? 'text-accent-red' : 'text-fg-label')}>
            {plan.cumplido
              ? t('tracking.detail.cumplido')
              : overdue
                ? t('tracking.next.overdueBy', { days: -plan.daysToCompromiso })
                : t('tracking.next.withinDate')}
          </span>
        </div>
      </td>
    </tr>
  )
}
