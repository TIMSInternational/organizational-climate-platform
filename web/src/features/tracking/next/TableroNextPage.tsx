import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Check, LayoutDashboard, ListChecks, PanelsTopLeft, Target } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { Alert, AlertDescription, Button, Chip, DatePicker, EmptyState, Input, LoadingRegion, NetworkError, SkeletonText } from '../../../components/ui'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay, calendarDayLong } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import type { PlanAccion, RegistrarAvanceInput, SemaforoCounts } from '../api/trackingApi'
import SemaforoChip, { SemaforoGlyph } from '../components/SemaforoChip'
import { todayIso } from '../planDates'
import { SEMAFORO_ORDER, fromPercent, semaforoCount, semaforoPresentation } from '../semaforo'
import { canCreatePlan, readTrackingClaims } from '../trackingAccess'
import { fullDay, leadingEstado, nextCompromiso } from './derive'
import type { TableroModel, TableroPlanCard } from './model'
import { InfoBox, NodoTile, ProgressTrack, SampleChip } from './parts'
import { useTableroModel, type TableroState } from './useTableroModel'

/** "1 verde", "0 amarillo", "0 rojo" — the board's tile counts each state by its colour word. */
const COUNT_KEY: Record<keyof SemaforoCounts, string> = {
  rojo: 'tracking.next.countRojo',
  amarillo: 'tracking.next.countAmarillo',
  verde: 'tracking.next.countVerde',
}

/**
 * `/tracking/tablero` — the redesigned Tablero de Seguimiento, the TrackingTablero
 * artboard of 10 Sep. It replaced `pages/TableroSeguimientoPage.tsx` on this route; that
 * page stays in the tree, unrouted, as the wiring reference.
 *
 * A node leader's own board: where the nodo stands (four tiles), then each plan as a card
 * with its semáforo, its progress against the compromiso, and — for the viewer who may
 * write — the avance recorded right there. An administrator reaches the same board for
 * any nodo from the consolidado (`?nodoId=`).
 *
 * ## Roles
 *
 * From the seam: `leadsANodo` is the leader with a real node claim; `canViewConsolidado`
 * is the administrator who must name one. A leader whose claim names no node gets the
 * artboard's "persona sin nodo asignado" card; a supervisor or an employee is told the
 * board is the leader's and pointed at Mis tareas. The write form shows only where
 * `canRecordProgress(plan)` holds — `PlanAccessHandler`, claim for claim.
 *
 * ## Sample data
 *
 * "Avances registrados" sums the bitácora, which `PlanResponse` does not carry
 * (`sampleModel.ts`); that tile wears the "Datos de muestra" chip and nothing else does.
 */
export default function TableroNextPage() {
  const { t } = useTranslation()
  const state = useTableroModel()
  const nodoName = state.model?.nodoName ?? null

  return (
    <div>
      <PageTopBar
        eyebrow={nodoName ? t('tracking.next.tableroEyebrow', { nodo: nodoName }) : null}
        title={t('tracking.tableroTitle')}
        description={state.adminView ? t('tracking.tableroDescription') : t('tracking.next.tableroDescription')}
      />
      <TableroBody state={state} />
    </div>
  )
}

function TableroBody({ state }: { state: TableroState }) {
  const { t, locale } = useTranslation()

  switch (state.status) {
    case 'choose-nodo':
      return (
        <VariantCard
          title={t('tracking.tableroChooseNodoTitle')}
          body={t('tracking.tableroChooseNodoBody')}
          actions={
            <Button asChild variant="outline">
              <Link to="/tracking">
                <PanelsTopLeft aria-hidden="true" />
                {t('tracking.tableroBackToConsolidado')}
              </Link>
            </Button>
          }
        />
      )
    case 'no-nodo':
      return (
        <VariantCard
          title={t('tracking.next.noNodoTitle')}
          body={t('tracking.next.noNodoBody')}
          actions={
            <>
              <Button asChild variant="outline">
                <Link to="/tracking/planes">
                  <Target aria-hidden="true" />
                  {t('tracking.next.goToPlans')}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/dashboard">
                  <LayoutDashboard aria-hidden="true" />
                  {t('tracking.next.backToDashboard')}
                </Link>
              </Button>
            </>
          }
        />
      )
    case 'restricted':
      return (
        <VariantCard
          title={t('tracking.tableroRestrictedTitle')}
          body={t('tracking.tableroRestrictedBody')}
          actions={
            <Button asChild variant="outline">
              <Link to="/tracking/mis-tareas">
                <ListChecks aria-hidden="true" />
                {t('tracking.next.goToMisTareas')}
              </Link>
            </Button>
          }
        />
      )
    case 'error':
      return (
        <NetworkError
          title={t('tracking.serviceUnavailableTitle')}
          description={t('tracking.serviceUnavailableBody')}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      )
    default:
      return (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' || !state.model ? (
            <SkeletonText lines={6} />
          ) : (
            <Board model={state.model} onRecord={state.recordAvance} t={t} locale={locale} />
          )}
        </LoadingRegion>
      )
  }
}

/** The board's one-card states: no nodo to show, or not this viewer's screen. */
function VariantCard({ title, body, actions }: { title: string; body: string; actions: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-lg border border-line-default bg-surface-card px-6 py-7 text-center shadow-sm" data-slot="tablero-variant">
      <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-md bg-surface-icon-box text-fg-secondary">
        <PanelsTopLeft className="size-4" />
      </span>
      <h2 className="m-0">{title}</h2>
      <p className="m-0 max-w-[56ch] text-base text-fg-secondary">{body}</p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>
    </div>
  )
}

function Board({
  model,
  onRecord,
  t,
  locale,
}: {
  model: TableroModel
  onRecord: (plan: PlanAccion, input: RegistrarAvanceInput) => Promise<void>
  t: TranslateFn
  locale: string
}) {
  const capabilities = useViewerCapabilities()
  const open = model.plans.filter((plan) => !plan.cumplido)
  const next = nextCompromiso(model.plans)
  const lead = leadingEstado(model.conteos)
  const anyWritable = open.some((card) => capabilities.canRecordProgress(card.plan))
  const mayCreate = canCreatePlan(readTrackingClaims())

  return (
    <div className="flex flex-col gap-section">
      <section aria-labelledby="tablero-donde" className="flex flex-col gap-2.5">
        <h2 id="tablero-donde" className="m-0">
          {t('tracking.next.whereHeading')}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <NodoTile label={t('tracking.next.tilePlanes')}>
            <span className="font-mono text-3xl leading-none text-fg-primary tabular-nums">{open.length}</span>
            <span className="text-sm text-fg-label">{open.length === 1 ? t('tracking.next.openOne') : t('tracking.next.openMany')}</span>
          </NodoTile>
          <NodoTile label={t('tracking.next.tileSemaforo')}>
            <span className="flex h-7 flex-wrap items-center gap-2" data-slot="semaforo-tile">
              {lead ? (
                <>
                  <Chip
                    tone={semaforoPresentation(lead).tone}
                    icon={<SemaforoGlyph estado={lead} className="size-3" />}
                    label={t(COUNT_KEY[semaforoPresentation(lead).countKey], { count: semaforoCount(model.conteos, lead) })}
                  />
                  <span className="text-sm text-fg-label">
                    {[...SEMAFORO_ORDER]
                      .reverse()
                      .filter((estado) => estado !== lead)
                      .map((estado) => t(COUNT_KEY[semaforoPresentation(estado).countKey], { count: semaforoCount(model.conteos, estado) }))
                      .join(' · ')}
                  </span>
                </>
              ) : (
                <span className="text-sm text-fg-label">{t('tracking.next.noPlansYet')}</span>
              )}
            </span>
          </NodoTile>
          <NodoTile label={t('tracking.next.tileProximo')}>
            {next ? (
              <>
                <span className="font-mono text-3xl leading-none text-fg-primary tabular-nums">
                  {calendarDay(Date.parse(next.fechaCompromiso), locale)}
                </span>
                <span className={cn('text-sm', next.daysToCompromiso < 0 ? 'text-accent-red' : 'text-fg-label')}>
                  {daysNote(t, next.daysToCompromiso)}
                </span>
              </>
            ) : (
              <>
                <span className="font-mono text-3xl leading-none text-fg-primary">—</span>
                <span className="text-sm text-fg-label">{t('tracking.next.noneDue')}</span>
              </>
            )}
          </NodoTile>
          <NodoTile label={t('tracking.next.tileAvances')} note={model.avancesAreSample ? <SampleChip /> : undefined}>
            <span className="font-mono text-3xl leading-none text-fg-primary tabular-nums">{model.avancesRegistrados}</span>
            <span className="text-sm text-fg-label">
              {model.avancesRegistrados > 0
                ? t('tracking.next.avancesInBitacora')
                : anyWritable
                  ? t('tracking.next.firstBelow')
                  : t('tracking.next.noneYet')}
            </span>
          </NodoTile>
        </div>
      </section>

      <section aria-labelledby="tablero-planes" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="tablero-planes" className="m-0">
            {t('tracking.planes.listTitle')}
          </h2>
          <p className="m-0 text-xs text-fg-label">
            {model.plans.length === 1 ? t('tracking.next.planesNoteOne') : t('tracking.next.planesNoteMany', { count: model.plans.length })}
          </p>
        </div>
        {model.plans.length === 0 ? (
          <EmptyState
            fill
            title={t('tracking.tableroEmptyTitle')}
            description={t('tracking.tableroEmptyBody')}
            action={
              mayCreate ? (
                <Button asChild variant="primary">
                  <Link to="/tracking/planes">{t('tracking.actions.createPlan')}</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          model.plans.map((card) => (
            <PlanCard
              key={card.id}
              card={card}
              nodoName={model.nodoName}
              writable={!card.cumplido && capabilities.canRecordProgress(card.plan)}
              onRecord={onRecord}
              t={t}
              locale={locale}
            />
          ))
        )}
      </section>
    </div>
  )
}

function daysNote(t: TranslateFn, days: number): string {
  if (days < 0) return t('tracking.next.overdueBy', { days: -days })
  if (days === 0) return t('tracking.next.dueToday')
  return days === 1 ? t('tracking.next.inOneDay') : t('tracking.next.inDays', { days })
}

function PlanCard({
  card,
  nodoName,
  writable,
  onRecord,
  t,
  locale,
}: {
  card: TableroPlanCard
  nodoName: string | null
  writable: boolean
  onRecord: (plan: PlanAccion, input: RegistrarAvanceInput) => Promise<void>
  t: TranslateFn
  locale: string
}) {
  const overdue = !card.cumplido && card.daysToCompromiso < 0
  const headingId = `tablero-plan-${card.id}`
  const sentence = card.cumplido
    ? t('tracking.detail.yaCumplido')
    : overdue
      ? card.hasProgress
        ? t('tracking.next.overdueWithProgress', { percent: card.percent })
        : t('tracking.next.overdueNoProgress')
      : t('tracking.next.onTimeBoard')

  return (
    <article aria-labelledby={headingId} data-plan={card.code} className="flex flex-col gap-3 rounded-lg border border-line-default bg-surface-card px-5 pb-4.5 pt-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Chip label={card.code} className="font-mono" />
            <SemaforoChip estado={card.estado} long />
            {nodoName && <span className="text-sm text-fg-label">{t('tracking.next.nodoLabel', { nodo: nodoName })}</span>}
          </div>
          <h3 id={headingId} className="m-0 font-store-serif text-2xl font-normal">
            {card.que}
          </h3>
        </div>
        <Link to={`/tracking/planes/${card.id}`} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-base text-fg-secondary no-underline hover:underline">
          {t('tracking.next.viewPlan')}
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-5">
        <span className="shrink-0 whitespace-nowrap font-mono text-[36px] leading-none text-fg-primary tabular-nums">
          {t('tracking.next.percentBig', { percent: card.percent })}
        </span>
        <div className="flex min-w-0 flex-col gap-1 pb-0.5">
          <span className="text-base text-fg-secondary">
            {t('tracking.next.goalFor', { date: calendarDayLong(Date.parse(card.fechaCompromiso), locale) })}
          </span>
          <span className={cn('text-sm', overdue ? 'text-accent-red' : 'text-accent-green-ink')}>{sentence}</span>
        </div>
      </div>

      <ProgressTrack percent={card.percent} overdue={overdue} label={t('tracking.next.progressLabel', { percent: card.percent })} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <InfoBox
          label={t('tracking.next.boxCompromiso')}
          value={fullDay(card.fechaCompromiso, locale)}
          sub={daysNote(t, card.daysToCompromiso)}
          mono
          alarm={overdue}
        />
        <InfoBox
          label={t('tracking.next.boxUltimoAvance')}
          value={card.hasProgress ? fullDay(card.fechaUltimaActualizacion, locale) : '—'}
          sub={card.hasProgress ? t('tracking.next.percentRecorded', { percent: card.percent }) : t('tracking.next.noneYet')}
          mono
        />
        <InfoBox
          label={t('tracking.next.boxResponsable')}
          value={card.responsable.name ?? t('tracking.next.personaUnnamed')}
          sub={card.responsable.name ? card.responsable.email ?? undefined : t('tracking.next.personaUnnamedSub')}
        />
      </div>

      {writable && <AvanceInlineForm card={card} onRecord={onRecord} t={t} locale={locale} />}
    </article>
  )
}

/** `YYYY-MM-DD` as the local-midnight `Date` the picker's calendar works in. */
function dateOfIso(iso: string): Date | undefined {
  const [year, month, day] = iso.split('-').map(Number)
  return year && month && day ? new Date(year, month - 1, day) : undefined
}

/** The picker's local-midnight `Date` back to the `DateOnly` the service takes. */
function isoOfDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * "Registrar avance", in the card: the percentage, the day it corresponds to, and a
 * line of what was done. The day is the app's date picker printing the board's own
 * "10 sept 2026" in the reader's language — the browser's `type="date"` control printed
 * its own locale's numeric form ("09/10/2026" in the shot browser) instead. The typed percentage crosses `semaforo.fromPercent` — the one
 * conversion back into the wire's fraction — and is refused outside 0–100 before it is
 * sent, with the same sentence the plan detail's form uses.
 */
function AvanceInlineForm({
  card,
  onRecord,
  t,
  locale,
}: {
  card: TableroPlanCard
  onRecord: (plan: PlanAccion, input: RegistrarAvanceInput) => Promise<void>
  t: TranslateFn
  locale: string
}) {
  const [percent, setPercent] = useState(String(card.percent))
  const [fecha, setFecha] = useState(() => todayIso())
  const [comentario, setComentario] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idBase = `avance-${card.id}`

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = Number(percent)
    if (percent.trim() === '' || !Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setSaving(true)
    setError(null)
    try {
      await onRecord(card.plan, {
        porcentajeAvance: fromPercent(parsed),
        comentario: comentario.trim() === '' ? null : comentario.trim(),
        fecha,
      })
      setComentario('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-labelledby={`${idBase}-title`}
      className="flex flex-col gap-2.5 rounded-md border border-line-light bg-surface-outer px-4 py-3.5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span id={`${idBase}-title`} className="text-base font-semibold text-fg-primary">
          {t('tracking.actions.registrarAvance')}
        </span>
        <span className="text-xs text-fg-label">{t('tracking.next.formNote')}</span>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-2.5">
        <div className="flex w-24 flex-col gap-1">
          <label htmlFor={`${idBase}-percent`} className="mb-0 text-2xs font-bold uppercase tracking-label text-fg-label">
            {t('tracking.next.fieldAvance')}
          </label>
          <div className="relative">
            <Input
              id={`${idBase}-percent`}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={percent}
              onChange={(event) => setPercent(event.target.value)}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${idBase}-range` : undefined}
              disabled={saving}
              className="pr-7 font-mono"
            />
            <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-sm text-fg-label">
              %
            </span>
          </div>
        </div>
        <div className="flex w-40 flex-col gap-1">
          <span aria-hidden="true" className="mb-0 text-2xs font-bold uppercase tracking-label text-fg-label">
            {t('tracking.next.fieldFecha')}
          </span>
          <DatePicker
            label={t('tracking.next.fieldFecha')}
            placeholder={t('tracking.next.fieldFechaPlaceholder')}
            value={dateOfIso(fecha)}
            onChange={(date) => {
              if (date) setFecha(isoOfDate(date))
            }}
            formatValue={(date) => fullDay(isoOfDate(date), locale)}
            showIcon={false}
            disabled={saving}
            className="font-mono"
          />
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <label htmlFor={`${idBase}-que`} className="mb-0 text-2xs font-bold uppercase tracking-label text-fg-label">
            {t('tracking.next.fieldQueSeHizo')}
          </label>
          <Input
            id={`${idBase}-que`}
            value={comentario}
            onChange={(event) => setComentario(event.target.value)}
            placeholder={t('tracking.next.fieldQueSeHizoPlaceholder')}
            disabled={saving}
          />
        </div>
        <Button type="submit" variant="primary" disabled={saving}>
          <Check aria-hidden="true" />
          {saving ? t('common.saving') : t('tracking.next.saveAvance')}
        </Button>
      </div>
      {invalid && (
        <p id={`${idBase}-range`} role="alert" className="m-0 text-sm text-accent-red">
          {t('tracking.fields.avanceRange')}
        </p>
      )}
    </form>
  )
}
