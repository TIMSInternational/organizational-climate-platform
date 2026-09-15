import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { CalendarDays, CircleAlert, Clock, Check, ListChecks, Shield, User, Users } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { Chip, LoadingRegion, NetworkError, SkeletonText, Table } from '../../../components/ui'
import { calendarDay } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import SemaforoChip from '../components/SemaforoChip'
import { SEMAFORO_ORDER, semaforoPresentation, type SemaforoEstado } from '../semaforo'
import { nextCompromiso } from './derive'
import { tallyTareas, type TareaRow } from './misTareas'
import { MiniBar } from '../../org-structure/next/super/parts'
import { useMisTareasModel } from './useMisTareasModel'

const TH = 'h-auto bg-transparent px-1.5 pb-2 pt-2 first:pl-3 last:pr-3 text-2xs font-bold uppercase tracking-label text-fg-label whitespace-nowrap'
const TD = 'px-1.5 py-3 align-middle first:pl-3 last:pr-3'

const TONE_INK: Record<string, string> = {
  critical: 'text-accent-red',
  warning: 'text-accent-amber-ink',
  good: 'text-accent-green-ink',
}

const STATE_ICON: Record<SemaforoEstado, ReactNode> = {
  Rojo: <CircleAlert aria-hidden="true" className="size-3.5" />,
  Amarillo: <Clock aria-hidden="true" className="size-3.5" />,
  Verde: <Check aria-hidden="true" className="size-3.5" />,
}

const LEGEND: Record<SemaforoEstado, string> = {
  Rojo: 'tracking.next.planesLegendRojo',
  Amarillo: 'tracking.next.planesLegendAmarillo',
  Verde: 'tracking.next.planesLegendVerde',
}

/**
 * `/tracking/mis-tareas` — the redesigned *Mis tareas*, the MisTareas and MisTareasAsignadas
 * artboards of 10 Sep. It replaced `pages/MisTareasPage.tsx` on this route; that page stays
 * in the tree, unrouted, as the wiring reference.
 *
 * Two boards, one screen: the empty one, which is what the tenant's supervisors actually see
 * today, and the one with a row. They share a header, a table and a closing notice, and
 * differ by a "Lo próximo" card and a legend that only exist when there is something to lead
 * with. That is the whole difference the artboards draw, and it is why they are one component.
 *
 * ## The one genuinely non-admin page in this feature
 *
 * `DashboardEndpoints.MisTareasAsync` reads **no role claim at all** — it filters on the
 * caller's own `PersonaExternalId` against each plan's `ResponsableEjecucionExternalId` and
 * `_involucradosExternalIds`, a statement about the person rather than about their rank. So
 * an `employee`, a `supervisor` and a `leader` all load this and all get their own list,
 * which is what makes it safe to put in a role-aware nav for roles that have almost nothing
 * else to reach. Contrast `/api/tablero-seguimiento`, which `Forbid`s a non-admin asking
 * about any node but their own, and `/api/consolidado`, which `Forbid`s every non-admin.
 *
 * ## Read-only, and it says so — but not the same sentence to everybody
 *
 * `PlanAccessHandler` gives an involucrado — and the responsable de ejecución — `Read` and
 * nothing more, so this page offers no write control of any kind and names who to go to
 * instead, rather than showing buttons that would 403.
 *
 * The notice used to be unconditional, and for one reader it was false. **A node leader is a
 * first-class caller here**: a leader named on a plan of their own jefatura is in this list,
 * and `canManagePlan` gives them write access to exactly that plan. Telling them "el avance
 * lo registra la jefatura del nodo" names them in the third person, one click before the
 * detail page hands them the `RegistrarAvanceForm` the sentence just said was somebody
 * else's — photographed doing it, as a leader on `nodo-operaciones`. So the page asks the
 * same predicate the detail page asks. Nothing about what this page *does* changes; only
 * which of two true sentences the reader is given.
 */
export default function MisTareasNextPage() {
  const { t, locale } = useTranslation()
  const state = useMisTareasModel()
  const rows = state.rows
  const next = nextCompromiso(rows)
  const asOfDay = calendarDay(Date.parse(`${state.asOf}T00:00:00Z`), locale)

  return (
    <div className="flex flex-col gap-section">
      <PageTopBar
        eyebrow={t('tracking.next.consolidadoEyebrowBare')}
        title={t('tracking.misTareas.title')}
        description={t('tracking.next.misTareasDescription')}
      />

      {state.status === 'error' ? (
        // `tracking.serviceUnavailable*`, never the browser's own words: a rejected `fetch`
        // is what a stopped container, a DNS failure and an unlisted CORS origin all look
        // like here, and "Failed to fetch" was once shown to an end user on this very route.
        <NetworkError
          title={t('tracking.serviceUnavailableTitle')}
          description={t('tracking.serviceUnavailableBody')}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' ? (
            // No "Lo próximo" card and no tally while loading: a card of zeros is a reading
            // nobody took, and on this screen it would read "you have nothing assigned".
            <SkeletonText lines={5} />
          ) : (
            <div className="flex flex-col gap-4">
              {next && <NextCard row={next} rows={rows} t={t} locale={locale} />}

              <section
                aria-labelledby="mis-tareas-lista"
                className="overflow-hidden rounded-xl border border-line-default bg-surface-card shadow-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pb-3.5 pt-4">
                  <div className="flex items-center gap-2.5">
                    <h2 id="mis-tareas-lista" className="m-0 text-2xl">
                      {t('tracking.next.misTareasListTitle')}
                    </h2>
                    <span className="font-mono text-xs tabular-nums text-fg-label">{rows.length}</span>
                  </div>
                  <span className="text-xs text-fg-label sm:text-right">
                    {rows.length === 0 ? t('tracking.next.misTareasAsOf', { date: asOfDay }) : t('tracking.next.misTareasOrdered')}
                  </span>
                </div>
                <TareasTable rows={rows} t={t} locale={locale} />
                {rows.length === 0 && <EmptyBlock t={t} />}
              </section>

              {rows.length > 0 && <Legend asOfDay={asOfDay} t={t} />}

              <p className="m-0 flex items-start gap-2.5 rounded-lg bg-surface-icon-box px-3.5 py-3 text-sm leading-normal text-fg-secondary">
                <Shield aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{notice(rows, t)}</span>
              </p>
            </div>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}

/**
 * The closing sentence, which is three sentences depending on who is reading.
 *
 * `some`, not `every`: a leader can hold a mixed list — a plan on their own node beside one
 * they were merely involved in elsewhere — and the sentence that would be wrong for them is
 * the one denying they may record any progress at all. Where they can record some, the
 * manager's line is the true one and the detail page draws the per-plan boundary exactly.
 */
function notice(rows: readonly TareaRow[], t: TranslateFn): string {
  if (rows.some((row) => row.managedByReader)) return t('tracking.next.misTareasManager')
  if (rows.length === 1) {
    const only = rows[0]
    return t('tracking.next.misTareasReadOnlyOne', {
      code: only.code,
      jefatura: only.nodoName ? t('tracking.next.misTareasJefatura', { nodo: only.nodoName }) : t('tracking.next.misTareasJefaturaBare'),
    })
  }
  return t('tracking.next.misTareasReadOnly')
}

function dueLine(row: TareaRow, t: TranslateFn, locale: string): string {
  const date = calendarDay(Date.parse(`${row.fechaCompromiso}T00:00:00Z`), locale)
  if (row.overdue) return t('tracking.next.misTareasNextOverdue', { date, days: -row.daysToCompromiso })
  if (row.daysToCompromiso === 0) return t('tracking.next.misTareasNextDueToday', { date })
  if (row.daysToCompromiso === 1) return t('tracking.next.misTareasNextDueOne', { date })
  return t('tracking.next.misTareasNextDue', { date, days: row.daysToCompromiso })
}

/** MisTareasAsignadas' "Lo próximo": the next commitment, and the whole list in one line. */
function NextCard({ row, rows, t, locale }: { row: TareaRow; rows: readonly TareaRow[]; t: TranslateFn; locale: string }) {
  const tally = tallyTareas(rows)
  return (
    <section
      aria-labelledby="mis-tareas-proximo"
      data-slot="lo-proximo"
      className="flex flex-wrap items-center gap-3.5 rounded-xl border border-line-default bg-surface-card px-4 py-3.5 shadow-sm"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-icon-box text-fg-secondary"
      >
        <CalendarDays className="size-4" />
      </span>
      {/* `flex-[1_1_17rem]`, not `flex-1`. `flex-1` is `flex: 1 1 0%` — a base size of zero,
          so the two columns always "fit" and the row never wraps: at 390 the tally on the
          right kept its whole width and this column was squeezed to about 70px, breaking
          "PA-2026-00002" across three lines and the due date across five. A real basis makes
          the line break instead. Only the PNG showed it. */}
      <div className="flex min-w-0 flex-[1_1_17rem] flex-col gap-1">
        <span id="mis-tareas-proximo" className="text-2xs font-bold uppercase tracking-label text-fg-label">
          {t('tracking.next.misTareasNext')}
        </span>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-base text-fg-primary">{row.code}</span>
          <span className={cn('text-base', row.overdue ? 'text-accent-red' : 'text-fg-primary')}>{dueLine(row, t, locale)}</span>
          <SemaforoChip estado={row.estado} />
          <span className="text-xs text-fg-label">
            {row.hasProgress
              ? t('tracking.next.misTareasWithAvance', {
                  percent: row.percent,
                  date: calendarDay(Date.parse(`${row.fechaUltimaActualizacion}T00:00:00Z`), locale),
                })
              : t('tracking.next.misTareasNoAvance', { percent: row.percent })}
          </span>
        </div>
      </div>
      <div className="flex min-w-0 shrink-0 flex-col gap-0.5 sm:items-end">
        <span className="font-mono text-base text-fg-primary">
          {tally.total === 1 ? t('tracking.next.misTareasCountOne') : t('tracking.next.misTareasCountMany', { count: tally.total })}
        </span>
        <span className="text-xs text-fg-label">
          {t('tracking.next.misTareasTally', { rojo: tally.counts.rojo, amarillo: tally.counts.amarillo, verde: tally.counts.verde })}
        </span>
      </div>
    </section>
  )
}

/**
 * The table, header row included, whether or not there is a row under it.
 *
 * The empty board draws the seven column headers above its message on purpose: they say what
 * a task WILL show when one arrives, which is the difference between "nothing yet" and "this
 * screen does nothing".
 */
function TareasTable({ rows, t, locale }: { rows: readonly TareaRow[]; t: TranslateFn; locale: string }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[64rem] [&_[data-slot=table-container]]:overflow-visible">
        <Table aria-label={t('tracking.next.misTareasListTitle')} className="table-fixed">
          <colgroup>
            <col className="w-31" />
            <col />
            <col className="w-30" />
            <col className="w-42.5" />
            <col className="w-27.5" />
            <col className="w-27.5" />
            <col className="w-22.5" />
          </colgroup>
          <thead>
            <tr className="border-b border-line-default">
              <th className={TH}>{t('tracking.next.planesColCodigo')}</th>
              <th className={TH}>{t('tracking.next.misTareasColQue')}</th>
              <th className={TH}>{t('tracking.next.misTareasColPapel')}</th>
              <th className={TH}>{t('tracking.next.misTareasColNodo')}</th>
              <th className={TH}>{t('tracking.next.planesColCompromiso')}</th>
              <th className={TH}>{t('tracking.columnEstado')}</th>
              <th className={TH}>{t('tracking.next.planesColAvance')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TareaTableRow key={row.id} row={row} t={t} locale={locale} />
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  )
}

function TareaTableRow({ row, t, locale }: { row: TareaRow; t: TranslateFn; locale: string }) {
  return (
    <tr data-plan-code={row.code} className="border-b border-line-light last:border-b-0">
      <td className={TD}>
        <Link
          to={`/tracking/planes/${row.id}`}
          aria-label={t('tracking.next.planesOpenNamed', { code: row.code })}
          className="font-mono text-xs text-fg-secondary underline decoration-line-hover underline-offset-4"
        >
          {row.code}
        </Link>
      </td>
      <td className={TD}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold text-fg-primary">{row.que}</span>
          {row.como && <span className="line-clamp-2 text-xs text-fg-label">{row.como}</span>}
        </span>
      </td>
      <td className={TD}>
        <Chip
          label={row.papel === 'responsable' ? t('tracking.next.misTareasPapelResponsable') : t('tracking.next.misTareasPapelInvolucrado')}
          icon={row.papel === 'responsable' ? <User /> : <Users />}
        />
      </td>
      <td className={TD}>
        {/* Who records the avance on THIS plan. For a node leader listed here on a plan of
            their own jefatura the answer is "you", and naming the jefatura instead would be
            the same third-person mistake the closing notice used to make.

            The nodo's NAME is a second fact and often absent: the nodo directory is
            admin-only (`TrackingPickerEndpoints.cs:19-21`), so a reader resolves their own
            department and no other — and most of this list is, by construction, other
            people's nodos. Where there is no name the cell is one line rather than a line
            saying there is no name above a line that repeats it. */}
        <span className="flex min-w-0 flex-col gap-0.5">
          {row.nodoName && <span className="truncate text-sm text-fg-secondary">{row.nodoName}</span>}
          <span className={cn('truncate', row.nodoName ? 'text-2xs text-fg-label' : 'text-sm text-fg-secondary')}>
            {row.managedByReader
              ? t('tracking.next.planesPapelRegistrasBare')
              : row.nodoName
                ? t('tracking.next.misTareasJefatura', { nodo: row.nodoName })
                : t('tracking.next.misTareasJefaturaBare')}
          </span>
        </span>
      </td>
      <td className={TD}>
        <span className="flex flex-col gap-0.5">
          <span className={cn('font-mono text-sm tabular-nums', row.overdue ? 'text-accent-red' : 'text-fg-primary')}>
            {calendarDay(Date.parse(`${row.fechaCompromiso}T00:00:00Z`), locale)}
          </span>
          <span className={cn('text-2xs', row.overdue ? 'text-accent-red' : 'text-fg-label')}>
            {row.overdue
              ? t('tracking.next.overdueBy', { days: -row.daysToCompromiso })
              : row.daysToCompromiso === 0
                ? t('tracking.next.planesDueToday')
                : row.daysToCompromiso === 1
                  ? t('tracking.next.planesInOneDay')
                  : t('tracking.next.planesInDays', { days: row.daysToCompromiso })}
          </span>
        </span>
      </td>
      <td className={TD}>
        <SemaforoChip estado={row.estado} />
      </td>
      <td className={TD}>
        <span className="flex flex-col gap-1.5" data-slot="avance">
          <span className="font-mono text-sm tabular-nums text-fg-primary">{t('tracking.next.planesPercent', { value: row.percent })}</span>
          <MiniBar percent={row.percent} className="w-18" />
        </span>
      </td>
    </tr>
  )
}

/**
 * MisTareas' empty board: a heading and a paragraph that say the list is empty **and that an
 * empty list is the answer**, not a figure still loading.
 *
 * Hand-built rather than `EmptyState`, which centres its copy: the artboard sets this block
 * left, under the column headers it belongs to.
 */
function EmptyBlock({ t }: { t: TranslateFn }) {
  return (
    <div className="flex items-start gap-4 px-4 pb-6 pt-7" data-slot="mis-tareas-empty" role="status">
      <span
        aria-hidden="true"
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-icon-box text-fg-secondary"
      >
        <ListChecks className="size-4.5" />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="m-0 text-2xl">{t('tracking.next.misTareasEmptyTitle')}</h3>
        <p className="m-0 max-w-[72ch] text-base leading-normal text-fg-secondary">{t('tracking.next.misTareasEmptyBody')}</p>
      </div>
    </div>
  )
}

function Legend({ asOfDay, t }: { asOfDay: string; t: TranslateFn }) {
  return (
    <div className="grid grid-cols-1 items-start gap-x-6 gap-y-2 text-xs text-fg-secondary xl:grid-cols-[minmax(0,1fr)_auto]">
      <ul className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-2 p-0 md:grid-cols-3">
        {SEMAFORO_ORDER.map((estado) => {
          const presentation = semaforoPresentation(estado)
          return (
            <li key={estado} className="m-0 flex min-w-0 items-start gap-1.5">
              <span className={cn('mt-px inline-flex shrink-0', TONE_INK[presentation.tone])}>{STATE_ICON[estado]}</span>
              <span className="min-w-0">
                <b className="font-semibold text-fg-primary">{t(presentation.labelKey)}:</b> {t(LEGEND[estado])}
              </span>
            </li>
          )
        })}
      </ul>
      <span className="text-fg-label">{t('tracking.next.misTareasLegendAsOf', { date: asOfDay })}</span>
    </div>
  )
}
