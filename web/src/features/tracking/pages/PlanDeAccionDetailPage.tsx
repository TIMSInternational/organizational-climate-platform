import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useCompanyScope } from '../../../company-context'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmationDialog,
  LoadingRegion,
  NetworkError,
  Progress,
  SkeletonText,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import {
  agregarInvolucrado,
  getPlanAccion,
  marcarCumplido,
  registrarAvance,
  type PlanAccion,
  type RegistrarAvanceInput,
} from '../api/trackingApi'
import { listPersonaOptions, type PersonaPickerItem } from '../api/trackingPickers'
import InvolucradosPicker from '../components/InvolucradosPicker'
import RegistrarAvanceForm from '../components/RegistrarAvanceForm'
import SemaforoChip from '../components/SemaforoChip'
import { planCalendarDay, todayIso } from '../planDates'
import { toPercent } from '../semaforo'
import { canManagePlan, readTrackingClaims } from '../trackingAccess'

/**
 * `/tracking/planes/:id` — one plan, and the three writes the module supports.
 *
 * ## The leader/involucrado split is the whole shape of this page
 *
 * `ClimateTracking.Application.Auth.PlanAccessHandler`: an admin or the node's
 * leader gets write; the responsable de ejecución and every involucrado get
 * **read and nothing else**. So this page has two faces, and `canManagePlan` —
 * which mirrors that handler claim for claim — decides which one renders.
 *
 * A read-only viewer sees the plan, the semáforo, the progress and the people on
 * it, plus a line saying who can record progress. They do not see a disabled
 * "Registrar avance" button, because a control that exists and refuses is worse
 * than one that was never offered: it invites a click, and the 403 that follows
 * reads as a bug rather than as a rule.
 *
 * The service re-checks all of this on every request. Nothing here is a security
 * boundary; it is the UI agreeing with the boundary.
 *
 * ## Percentages
 *
 * Everything on screen goes through `toPercent`, and the one number that goes back
 * goes through `fromPercent` inside `RegistrarAvanceForm`. `porcentajeAvance` is
 * stored `0–1`; see `semaforo.ts`.
 *
 * ## Involucrados are added one at a time, because the service adds one at a time
 *
 * `AgregarInvolucradoAsync` takes a single `PersonaExternalId`. The picker chooses
 * many, and this page posts them in sequence and reloads once — so the user gets a
 * multi-select even though the endpoint is singular. The requests are sequential
 * rather than `Promise.all`ed on purpose: each one returns the whole plan and the
 * handler mutates one entity, so firing them together races the same row.
 *
 * ## What this page will not show
 *
 * `hallazgoExternalId` and `cicloEncuestaExternalId` are rendered as opaque
 * references and are not links. A hallazgo is a survey finding, and a route from
 * a named action plan into per-response survey data is exactly the drill-through
 * the anonymity rule forbids — a plan names its responsable, so a link from here
 * to a response set would be a link from a person to answers.
 */
export default function PlanDeAccionDetailPage() {
  const { t, locale } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const claims = useMemo(() => readTrackingClaims(), [])

  const [plan, setPlan] = useState<PlanAccion | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [personas, setPersonas] = useState<PersonaPickerItem[]>([])

  const [avanceError, setAvanceError] = useState<string | null>(null)
  const [savingAvance, setSavingAvance] = useState(false)

  const [confirmCumplido, setConfirmCumplido] = useState(false)
  const [cumplidoError, setCumplidoError] = useState<string | null>(null)
  const [savingCumplido, setSavingCumplido] = useState(false)

  const [nuevosInvolucrados, setNuevosInvolucrados] = useState<string[]>([])
  const [involucradosError, setInvolucradosError] = useState<string | null>(null)
  const [savingInvolucrados, setSavingInvolucrados] = useState(false)

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    try {
      setPlan(await getPlanAccion(id))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [id, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // Silent, like the listing's: the directory only feeds the involucrados picker,
  // and `TrackingPickerEndpoints` refuses every non-admin role. A leader who can
  // write to this plan may still get a 403 here, and losing the whole page over a
  // picker would be the wrong trade.
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    void listPersonaOptions(companyId)
      .then((items) => {
        if (!cancelled) setPersonas(items)
      })
      .catch(() => {
        if (!cancelled) setPersonas([])
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  const mayManage = plan !== null && canManagePlan(plan, claims)

  async function handleAvance(input: RegistrarAvanceInput) {
    if (!id) return
    setSavingAvance(true)
    setAvanceError(null)
    try {
      setPlan(await registrarAvance(id, input))
    } catch (err) {
      setAvanceError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSavingAvance(false)
    }
  }

  async function handleCumplido() {
    if (!id) return
    setSavingCumplido(true)
    setCumplidoError(null)
    try {
      setPlan(await marcarCumplido(id, { fecha: todayIso() }))
      setConfirmCumplido(false)
    } catch (err) {
      setCumplidoError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setSavingCumplido(false)
    }
  }

  async function handleInvolucrados() {
    if (!id || nuevosInvolucrados.length === 0) return
    setSavingInvolucrados(true)
    setInvolucradosError(null)
    try {
      let latest: PlanAccion | null = null
      // Sequential, not parallel: each call loads, mutates and saves the same row.
      for (const personaExternalId of nuevosInvolucrados) {
        latest = await agregarInvolucrado(id, { personaExternalId })
      }
      if (latest) setPlan(latest)
      setNuevosInvolucrados([])
    } catch (err) {
      setInvolucradosError(err instanceof Error ? err.message : t('errors.generic'))
      // A partial success is still a success for the ones that landed, so the plan
      // is reloaded rather than left showing the pre-submit state.
      await reload()
    } finally {
      setSavingInvolucrados(false)
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-6">
        <PageTopBar title={t('tracking.detail.title')} />
        <NetworkError
          title={t('errors.generic')}
          description={loadError}
          onRetry={() => void reload()}
          retryText={t('common.retry')}
        />
      </div>
    )
  }

  if (loading || !plan) {
    return (
      <div className="flex flex-col gap-6">
        <PageTopBar title={t('tracking.detail.title')} />
        <LoadingRegion loading label={t('common.loading')}>
          <SkeletonText lines={6} />
        </LoadingRegion>
      </div>
    )
  }

  const percent = toPercent(plan.porcentajeAvance)

  return (
    <div className="flex flex-col gap-6">
      <PageTopBar
        title={plan.planCode}
        description={plan.descripcionQue}
        breadcrumbs={[
          { label: t('tracking.planes.title'), href: '/tracking/planes' },
          { label: plan.planCode },
        ]}
        badge={plan.cumplido ? { text: t('tracking.detail.cumplido'), variant: 'success' } : undefined}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('tracking.detail.estadoTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-inline">
            <SemaforoChip estado={plan.estadoSemaforo} />
            <span className="font-mono text-sm tabular-nums text-fg-primary">
              {t('tracking.table.percent', { percent })}
            </span>
          </div>
          <Progress value={percent} />

          <dl className="m-0 grid grid-cols-1 gap-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-fg-tertiary">{t('tracking.fields.nodo')}</dt>
            <dd className="m-0 font-mono text-fg-primary">{plan.nodoExternalId}</dd>

            <dt className="text-fg-tertiary">{t('tracking.fields.responsable')}</dt>
            <dd className="m-0 font-mono text-fg-primary">
              {plan.responsableEjecucionExternalId}
            </dd>

            <dt className="text-fg-tertiary">{t('tracking.fields.metodologiaComo')}</dt>
            <dd className="m-0 text-fg-primary">{plan.metodologiaComo}</dd>

            <dt className="text-fg-tertiary">{t('tracking.fields.fechaCreacion')}</dt>
            <dd className="m-0 font-mono tabular-nums text-fg-primary">
              {planCalendarDay(plan.fechaCreacion, locale)}
            </dd>

            <dt className="text-fg-tertiary">{t('tracking.fields.fechaCompromiso')}</dt>
            <dd className="m-0 font-mono tabular-nums text-fg-primary">
              {planCalendarDay(plan.fechaCompromiso, locale)}
            </dd>

            <dt className="text-fg-tertiary">{t('tracking.fields.ultimaActualizacion')}</dt>
            <dd className="m-0 font-mono tabular-nums text-fg-primary">
              {planCalendarDay(plan.fechaUltimaActualizacion, locale)}
            </dd>

            <dt className="text-fg-tertiary">{t('tracking.fields.hallazgo')}</dt>
            {/* Text, never a link. See the module comment: a route from a named plan
                into per-response survey data is the drill-through the anonymity rule
                forbids. */}
            <dd className="m-0 font-mono text-fg-secondary">
              {plan.hallazgoExternalId ?? t('common.none')}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('tracking.detail.involucradosTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {plan.involucradosExternalIds.length === 0 ? (
            <p className="text-sm text-fg-tertiary">{t('tracking.detail.sinInvolucrados')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-inline p-0">
              {plan.involucradosExternalIds.map((personaId) => {
                const persona = personas.find((item) => item.id === personaId)
                return (
                  <li key={personaId}>
                    <Badge variant="secondary">{persona ? persona.name : personaId}</Badge>
                  </li>
                )
              })}
            </ul>
          )}

          {mayManage && (
            <>
              {involucradosError && (
                <Alert variant="destructive">
                  <AlertDescription>{involucradosError}</AlertDescription>
                </Alert>
              )}
              <InvolucradosPicker
                label={t('tracking.fields.agregarInvolucrados')}
                description={t('tracking.fields.agregarInvolucradosHint')}
                personas={personas}
                value={nuevosInvolucrados}
                onChange={setNuevosInvolucrados}
                locked={plan.involucradosExternalIds}
                disabled={savingInvolucrados}
              />
              <div>
                <Button
                  type="button"
                  disabled={savingInvolucrados || nuevosInvolucrados.length === 0}
                  onClick={() => void handleInvolucrados()}
                >
                  {savingInvolucrados
                    ? t('common.saving')
                    : t('tracking.actions.agregarInvolucrados')}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {mayManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('tracking.detail.avanceTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {plan.cumplido ? (
              <Alert variant="success">
                <AlertDescription>{t('tracking.detail.yaCumplido')}</AlertDescription>
              </Alert>
            ) : (
              <>
                <RegistrarAvanceForm
                  // Remounted whenever the stored value changes, so the field shows
                  // what is on record rather than what was typed three saves ago.
                  key={plan.fechaUltimaActualizacion + String(plan.porcentajeAvance)}
                  currentAvance={plan.porcentajeAvance}
                  today={todayIso()}
                  submitting={savingAvance}
                  error={avanceError}
                  onSubmit={(input) => void handleAvance(input)}
                />
                {cumplidoError && (
                  <Alert variant="destructive">
                    <AlertDescription>{cumplidoError}</AlertDescription>
                  </Alert>
                )}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={savingCumplido}
                    onClick={() => setConfirmCumplido(true)}
                  >
                    {t('tracking.actions.marcarCumplido')}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Alert variant="info">
          <AlertDescription>{t('tracking.detail.readOnly')}</AlertDescription>
        </Alert>
      )}

      <ConfirmationDialog
        open={confirmCumplido}
        onOpenChange={setConfirmCumplido}
        title={t('tracking.actions.marcarCumplido')}
        description={t('tracking.detail.confirmCumplido')}
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onConfirm={() => void handleCumplido()}
      />
    </div>
  )
}
