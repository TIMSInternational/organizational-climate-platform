import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowRight, Check, Clock, Ellipsis, Plus, ShieldCheck } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Button,
  Chip,
  ConfirmationDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { calendarDay, calendarDayLong } from '../../../lib/calendarDay'
import { cn } from '../../../lib/cn'
import InvolucradosPicker from '../components/InvolucradosPicker'
import RegistrarAvanceForm from '../components/RegistrarAvanceForm'
import SemaforoChip from '../components/SemaforoChip'
import { todayIso } from '../planDates'
import { toPercent } from '../semaforo'
import { asSentence, dayDiff, fullDay, hasRecordedProgress, isOverdue } from './derive'
import type { PersonaRef, PlanDetailModel } from './model'
import { InfoBox, PersonaAvatar, ProgressTrack, SampleChip } from './parts'
import { usePlanDetailModel, type PlanDetailState } from './usePlanDetailModel'

/**
 * `/tracking/planes/:id` — the redesigned plan detail, the Main artboard of 10 Sep. It
 * replaced `pages/PlanDeAccionDetailPage.tsx` on this route; that page stays in the tree,
 * unrouted, as the wiring reference — read its module comment: the leader/involucrado
 * split is the whole shape of this screen too.
 *
 * The plan's "qué" is the title and its code a chip; Avance, Qué se hará y cómo and
 * Bitácora are separate cards; the Ficha and Involucrados sit in a right rail; the
 * directory stays behind a button.
 *
 * ## Who may write
 *
 * `canRecordProgress(plan)` from the seam — `PlanAccessHandler`, claim for claim: an
 * administrator, or the leader of this plan's nodo. Only that viewer gets "Registrar
 * avance", "Marcar cumplido" and "Agregar personas al plan"; the responsable and the
 * involucrados read, and the rail says who records progress. Adding people also needs
 * the directory, which only an administrator may list (`canUseDirectoryPickers`), so a
 * leader is told who does it rather than offered an empty picker.
 *
 * ## What this screen will not link
 *
 * The hallazgo is shown as a reference, never a link: a route from a named plan into
 * survey responses is the drill-through the anonymity rule forbids.
 *
 * ## Sample data
 *
 * The Bitácora is not on `PlanResponse` (`sampleModel.ts`); that card wears the
 * "Datos de muestra" chip and nothing else here does.
 */
export default function PlanDetailNextPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const state = usePlanDetailModel(id)

  if (state.status === 'not-found') {
    return (
      <div>
        <PageTopBar
          title={t('tracking.detail.title')}
          breadcrumbs={[{ label: t('tracking.planes.title'), href: '/tracking/planes' }, { label: t('tracking.detail.title') }]}
          tightBreadcrumb
        />
        <EmptyState
          fill
          title={t('tracking.next.notFoundTitle')}
          description={t('tracking.next.notFoundBody')}
          action={
            <Button asChild variant="outline">
              <Link to="/tracking/planes">{t('tracking.next.goToPlans')}</Link>
            </Button>
          }
        />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div>
        <PageTopBar title={t('tracking.detail.title')} />
        <NetworkError
          title={t('tracking.serviceUnavailableTitle')}
          description={t('tracking.serviceUnavailableBody')}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      </div>
    )
  }

  if (state.status === 'loading' || !state.model) {
    return (
      <div>
        <PageTopBar title={t('tracking.detail.title')} />
        <LoadingRegion loading label={t('common.loading')}>
          <SkeletonText lines={8} />
        </LoadingRegion>
      </div>
    )
  }

  return <PlanDetail model={state.model} state={state} />
}

function dueSentence(t: TranslateFn, locale: string, fecha: string, days: number, cumplido: boolean): string {
  if (cumplido) return t('tracking.detail.cumplido')
  const date = calendarDayLong(Date.parse(fecha), locale)
  if (days < 0) return t('tracking.next.vencio', { date, days: -days })
  if (days === 0) return t('tracking.next.venceHoy')
  return days === 1 ? t('tracking.next.venceManana', { date }) : t('tracking.next.vence', { date, days })
}

function PlanDetail({ model, state }: { model: PlanDetailModel; state: PlanDetailState }) {
  const { t, locale } = useTranslation()
  const capabilities = useViewerCapabilities()
  const { plan } = model
  const writable = capabilities.canRecordProgress(plan)
  const mayAddPeople = writable && capabilities.canUseDirectoryPickers
  const percent = toPercent(plan.porcentajeAvance)
  const overdue = isOverdue(plan, model.asOf)
  const progressed = hasRecordedProgress(plan)
  const days = dayDiff(model.asOf, plan.fechaCompromiso)
  const tableroHref = capabilities.canViewConsolidado
    ? `/tracking/tablero?nodoId=${encodeURIComponent(plan.nodoExternalId)}`
    : '/tracking/tablero'

  const [avanceOpen, setAvanceOpen] = useState(false)
  const [avanceError, setAvanceError] = useState<string | null>(null)
  const [savingAvance, setSavingAvance] = useState(false)
  const [cumplidoOpen, setCumplidoOpen] = useState(false)
  const [cumplidoError, setCumplidoError] = useState<string | null>(null)

  return (
    <div>
      <PageTopBar
        breadcrumbs={[{ label: t('tracking.planes.title'), href: '/tracking/planes' }, { label: plan.planCode }]}
        tightBreadcrumb
        eyebrow={model.nodoName ? t('tracking.next.detailEyebrow', { nodo: model.nodoName }) : t('tracking.detail.title')}
        title={plan.descripcionQue}
        // The Main artboard: the code, the semáforo and the date 10px apart, just under the
        // title — not the 6px status line the authoring boards draw.
        metaClassName="mt-0.5 gap-2.5"
        meta={
          <>
            <Chip label={plan.planCode} className="font-mono" />
            <SemaforoChip estado={plan.estadoSemaforo} />
            <span className={cn('text-base', overdue ? 'text-accent-red' : 'text-fg-secondary')}>
              {dueSentence(t, locale, plan.fechaCompromiso, days, plan.cumplido)}
            </span>
            <span className="text-base text-fg-label">
              {progressed
                ? t('tracking.next.metaLastAvance', { date: calendarDayLong(Date.parse(plan.fechaUltimaActualizacion), locale) })
                : t('tracking.next.metaNoAvances')}
            </span>
          </>
        }
        actions={
          <>
            {writable && !plan.cumplido && (
              <>
                <Button type="button" variant="primary" onClick={() => setAvanceOpen(true)}>
                  <Plus aria-hidden="true" />
                  {t('tracking.actions.registrarAvance')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setCumplidoOpen(true)}>
                  <Check aria-hidden="true" />
                  {t('tracking.next.marcarCumplido')}
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label={t('tracking.next.moreActions')}>
                  <Ellipsis aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={tableroHref}>{t('tracking.next.openTablero')}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/tracking/planes">{t('tracking.next.goToPlans')}</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {cumplidoError && (
        <Alert variant="destructive" className="mb-panel-gap">
          <AlertDescription>{cumplidoError}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <AvanceCard model={model} percent={percent} overdue={overdue} progressed={progressed} days={days} t={t} locale={locale} />
          <QueComoCard model={model} t={t} />
          <BitacoraCard model={model} progressed={progressed} t={t} locale={locale} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <FichaCard model={model} overdue={overdue} tableroHref={tableroHref} t={t} locale={locale} />
          <InvolucradosCard model={model} state={state} writable={writable} mayAddPeople={mayAddPeople} t={t} />
          <p className="m-0 flex gap-2.5 rounded-md bg-surface-icon-box px-3.5 py-3 text-xs text-fg-secondary">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>{t('tracking.next.whoWrites')}</span>
          </p>
        </div>
      </div>

      <Dialog open={avanceOpen} onOpenChange={setAvanceOpen}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('tracking.actions.registrarAvance')}</DialogTitle>
            <DialogDescription>{t('tracking.next.formNote')}</DialogDescription>
          </DialogHeader>
          <RegistrarAvanceForm
            key={plan.fechaUltimaActualizacion + String(plan.porcentajeAvance)}
            currentAvance={plan.porcentajeAvance}
            today={todayIso()}
            submitting={savingAvance}
            error={avanceError}
            onSubmit={(input) => {
              setSavingAvance(true)
              setAvanceError(null)
              state
                .recordAvance(input)
                .then(() => setAvanceOpen(false))
                .catch((err: unknown) => setAvanceError(err instanceof Error ? err.message : t('errors.generic')))
                .finally(() => setSavingAvance(false))
            }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={cumplidoOpen}
        onOpenChange={setCumplidoOpen}
        title={t('tracking.next.marcarCumplido')}
        description={t('tracking.detail.confirmCumplido')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={() => {
          setCumplidoError(null)
          state
            .markCumplido()
            .then(() => setCumplidoOpen(false))
            .catch((err: unknown) => {
              setCumplidoOpen(false)
              setCumplidoError(err instanceof Error ? err.message : t('errors.generic'))
            })
        }}
      />
    </div>
  )
}

function Card({ children, labelledBy, className }: { children: React.ReactNode; labelledBy: string; className?: string }) {
  return (
    <section aria-labelledby={labelledBy} className={cn('flex flex-col gap-3 rounded-lg border border-line-default bg-surface-card px-5 pb-4.5 pt-4 shadow-sm', className)}>
      {children}
    </section>
  )
}

function AvanceCard({
  model,
  percent,
  overdue,
  progressed,
  days,
  t,
  locale,
}: {
  model: PlanDetailModel
  percent: number
  overdue: boolean
  progressed: boolean
  days: number
  t: TranslateFn
  locale: string
}) {
  const { plan } = model
  const sentence = plan.cumplido
    ? t('tracking.detail.yaCumplido')
    : overdue
      ? progressed
        ? t('tracking.next.overdueWithProgress', { percent })
        : t('tracking.next.overdueNoProgress')
      : t('tracking.next.onTimeDetail')
  const createdDays = dayDiff(plan.fechaCreacion, model.asOf)
  const hito = plan.cumplido
    ? { value: t('tracking.next.hitoNone'), sub: t('tracking.detail.cumplido') }
    : overdue
      ? { value: t('tracking.next.hitoCumplir'), sub: t('tracking.next.hitoCumplirSub') }
      : progressed
        ? { value: t('tracking.next.hitoSiguiente'), sub: t('tracking.next.hitoBefore', { date: calendarDay(Date.parse(plan.fechaCompromiso), locale) }) }
        : { value: t('tracking.next.hitoPrimero'), sub: t('tracking.next.hitoBefore', { date: calendarDay(Date.parse(plan.fechaCompromiso), locale) }) }

  return (
    <Card labelledBy="plan-avance">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="plan-avance" className="m-0">
          {t('tracking.next.avanceHeading')}
        </h2>
        <span className="text-xs text-fg-label">
          {t('tracking.next.lastUpdate', { date: calendarDay(Date.parse(plan.fechaUltimaActualizacion), locale) })}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-5">
        <span className="shrink-0 whitespace-nowrap font-mono text-[40px] leading-none text-fg-primary tabular-nums">
          {t('tracking.next.percentBig', { percent })}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1 pb-1">
          <span className="text-base text-fg-secondary">
            {t('tracking.next.goalFor', { date: calendarDayLong(Date.parse(plan.fechaCompromiso), locale) })}
          </span>
          <span className={cn('text-sm', overdue ? 'text-accent-red' : 'text-accent-green-ink')}>{sentence}</span>
        </div>
      </div>
      <ProgressTrack percent={percent} overdue={overdue} label={t('tracking.next.progressLabel', { percent })} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InfoBox
          label={t('tracking.next.boxCreado')}
          value={fullDay(plan.fechaCreacion, locale)}
          sub={createdDays <= 0 ? t('tracking.next.createdToday') : t('tracking.next.createdAgo', { days: createdDays })}
          mono
        />
        <InfoBox
          label={t('tracking.next.boxCompromiso')}
          value={fullDay(plan.fechaCompromiso, locale)}
          sub={
            plan.cumplido
              ? t('tracking.detail.cumplido')
              : days < 0
                ? t('tracking.next.overdueBy', { days: -days })
                : days === 0
                  ? t('tracking.next.dueToday')
                  : t('tracking.next.inDays', { days })
          }
          mono
          alarm={overdue}
        />
        <InfoBox label={t('tracking.next.boxHito')} value={hito.value} sub={hito.sub} />
      </div>
    </Card>
  )
}

function QueComoCard({ model, t }: { model: PlanDetailModel; t: TranslateFn }) {
  const { plan } = model
  return (
    <Card labelledBy="plan-que-como">
      <h2 id="plan-que-como" className="m-0">
        {t('tracking.next.queComoHeading')}
      </h2>
      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-base">
        <dt className="pt-0.5 text-2xs font-bold uppercase tracking-label text-fg-label">{t('tracking.next.que')}</dt>
        <dd className="m-0 max-w-[70ch] text-fg-primary">{asSentence(plan.descripcionQue)}</dd>
        <dt className="pt-0.5 text-2xs font-bold uppercase tracking-label text-fg-label">{t('tracking.next.como')}</dt>
        <dd className="m-0 max-w-[70ch] text-fg-primary">{asSentence(plan.metodologiaComo)}</dd>
        <dt className="pt-0.5 text-2xs font-bold uppercase tracking-label text-fg-label">{t('tracking.fields.hallazgo')}</dt>
        {/* Text, never a link: see the module comment. */}
        <dd className="m-0 text-fg-label">
          {plan.hallazgoExternalId ? t('tracking.next.hallazgoRef', { ref: plan.hallazgoExternalId }) : t('tracking.next.hallazgoNone')}
        </dd>
      </dl>
    </Card>
  )
}

function personaName(t: TranslateFn, persona: PersonaRef): string {
  return persona.name ?? t('tracking.next.personaUnnamed')
}

function BitacoraCard({ model, progressed, t, locale }: { model: PlanDetailModel; progressed: boolean; t: TranslateFn; locale: string }) {
  const { plan, bitacora } = model
  const entries = 1 + bitacora.avances.length
  return (
    <Card labelledBy="plan-bitacora">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="flex items-center gap-2">
          <h2 id="plan-bitacora" className="m-0">
            {t('tracking.next.bitacoraHeading')}
          </h2>
          {model.bitacoraIsSample && <SampleChip />}
        </span>
        <span className="text-xs text-fg-label">
          {entries === 1 ? t('tracking.next.entriesOne') : t('tracking.next.entriesMany', { count: entries })}
        </span>
      </div>
      <ol className="m-0 flex list-none flex-col p-0">
        <li className="grid grid-cols-[96px_28px_minmax(0,1fr)] items-start gap-3 border-t border-line-light py-2.5">
          <span className="pt-1.5 font-mono text-sm text-fg-label">{calendarDay(Date.parse(plan.fechaCreacion), locale)}</span>
          <PersonaAvatar name={bitacora.creatorName} />
          <div className="flex flex-col gap-0.5 pt-1">
            <span className="text-base text-fg-primary">
              {bitacora.creatorName ? (
                <>
                  {t('tracking.next.createdBy')} <b className="font-semibold">{bitacora.creatorName}</b>
                </>
              ) : (
                t('tracking.next.created')
              )}
            </span>
            <span className="text-sm text-fg-label">
              {t('tracking.next.createdMeta', {
                name: personaName(t, model.responsable),
                date: calendarDay(Date.parse(plan.fechaCompromiso), locale),
              })}
            </span>
          </div>
        </li>
        {bitacora.avances.map((avance) => (
          <li key={`${avance.fecha}-${avance.autorName}`} className="grid grid-cols-[96px_28px_minmax(0,1fr)] items-start gap-3 border-t border-line-light py-2.5">
            <span className="pt-1.5 font-mono text-sm text-fg-label">{calendarDay(Date.parse(avance.fecha), locale)}</span>
            <PersonaAvatar name={avance.autorName} />
            <div className="flex flex-col gap-0.5 pt-1">
              <span className="text-base text-fg-primary">
                {t('tracking.next.avanceBy', { name: avance.autorName, percent: avance.percent })}
              </span>
              {avance.comentario && <span className="text-sm text-fg-label">{avance.comentario}</span>}
            </div>
          </li>
        ))}
      </ol>
      {bitacora.avances.length === 0 && (
        <div className="flex items-center gap-3 rounded-md border border-dashed border-line-default px-3 py-3 text-base text-fg-label">
          <Clock aria-hidden="true" className="size-4 shrink-0" />
          <span>
            {progressed ? (
              t('tracking.next.avancesNotListed', { date: calendarDayLong(Date.parse(plan.fechaUltimaActualizacion), locale) })
            ) : (
              <>
                {t('tracking.next.noAvancesLead')} <b className="font-semibold text-fg-primary">{t('tracking.actions.registrarAvance')}</b>
                {t('tracking.next.noAvancesTail')}
              </>
            )}
          </span>
        </div>
      )}
    </Card>
  )
}

function FichaCard({
  model,
  overdue,
  tableroHref,
  t,
  locale,
}: {
  model: PlanDetailModel
  overdue: boolean
  tableroHref: string
  t: TranslateFn
  locale: string
}) {
  const { plan } = model
  const term = 'text-fg-label'
  return (
    <Card labelledBy="plan-ficha" className="px-4.5">
      <h2 id="plan-ficha" className="m-0">
        {t('tracking.next.fichaHeading')}
      </h2>
      <dl className="m-0 grid grid-cols-[112px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-base">
        <dt className={term}>{t('tracking.fields.nodo')}</dt>
        <dd className="m-0">
          <Link to={tableroHref} className="inline-flex items-center gap-1.5 font-medium text-fg-primary no-underline hover:underline">
            {model.nodoName ?? t('tracking.next.nodoUnnamed')}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </dd>
        <dt className={term}>{t('tracking.next.fichaResponsable')}</dt>
        <dd className="m-0 flex min-w-0 items-center gap-2">
          <PersonaAvatar name={model.responsable.name} size="sm" />
          <span className={cn('truncate', model.responsable.name ? 'text-fg-primary' : 'text-fg-label')}>{personaName(t, model.responsable)}</span>
        </dd>
        <dt className={term}>{t('tracking.next.fichaJefatura')}</dt>
        <dd className={cn('m-0', model.lider?.name ? 'text-fg-primary' : 'text-fg-label')}>
          {model.lider ? personaName(t, model.lider) : t('tracking.next.sinAsignar')}
        </dd>
        <dt className={term}>{t('tracking.next.fichaCiclo')}</dt>
        <dd className="m-0 text-fg-label">{plan.cicloEncuestaExternalId ?? t('tracking.next.ninguno')}</dd>
        <dt className={term}>{t('tracking.next.fichaCreado')}</dt>
        <dd className="m-0 font-mono tabular-nums">{fullDay(plan.fechaCreacion, locale)}</dd>
        <dt className={term}>{t('tracking.next.boxCompromiso')}</dt>
        <dd className={cn('m-0 font-mono tabular-nums', overdue && 'text-accent-red')}>{fullDay(plan.fechaCompromiso, locale)}</dd>
        <dt className={term}>{t('tracking.next.fichaActualizado')}</dt>
        <dd className="m-0 font-mono tabular-nums">{fullDay(plan.fechaUltimaActualizacion, locale)}</dd>
      </dl>
    </Card>
  )
}

function InvolucradosCard({
  model,
  state,
  writable,
  mayAddPeople,
  t,
}: {
  model: PlanDetailModel
  state: PlanDetailState
  writable: boolean
  mayAddPeople: boolean
  t: TranslateFn
}) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = model.involucrados.length

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await state.addInvolucrados(chosen)
      setChosen([])
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card labelledBy="plan-involucrados" className="px-4.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="plan-involucrados" className="m-0">
          {t('tracking.detail.involucradosTitle')}
        </h2>
        <span className="text-xs text-fg-label">
          {count === 1 ? t('tracking.next.personasOne') : t('tracking.next.personasMany', { count })}
        </span>
      </div>
      {count === 0 ? (
        <p className="m-0 text-sm text-fg-label">{t('tracking.detail.sinInvolucrados')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {model.involucrados.map((persona) => (
            <li key={persona.id} className="flex min-w-0 items-center gap-2.5">
              <PersonaAvatar name={persona.name} />
              <div className="flex min-w-0 flex-col">
                <span className={cn('truncate text-base', persona.name ? 'text-fg-primary' : 'text-fg-label')}>{personaName(t, persona)}</span>
                {persona.email && <span className="truncate text-sm text-fg-label">{persona.email}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {mayAddPeople && (
        <>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {open ? (
            <>
              <InvolucradosPicker
                label={t('tracking.fields.agregarInvolucrados')}
                personas={state.directory}
                value={chosen}
                onChange={setChosen}
                locked={model.plan.involucradosExternalIds}
                disabled={saving}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="default" disabled={saving || chosen.length === 0} onClick={() => void save()}>
                  {saving ? t('common.saving') : t('tracking.actions.agregarInvolucrados')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setChosen([])
                    setOpen(false)
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </>
          ) : (
            <Button type="button" variant="outline" className="self-start" onClick={() => setOpen(true)}>
              <Plus aria-hidden="true" />
              {t('tracking.actions.abrirAgregarInvolucrados')}
            </Button>
          )}
          <p className="m-0 text-sm text-fg-label">{t('tracking.next.cannotRemove')}</p>
        </>
      )}
      {writable && !mayAddPeople && <p className="m-0 text-sm text-fg-label">{t('tracking.next.addByAdmin')}</p>}
    </Card>
  )
}
