import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCompanyScope } from '../../../company-context'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  LoadingRegion,
  NetworkError,
  SelectField,
  SkeletonText,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import {
  createPlanAccion,
  listPlanesAccion,
  type CreatePlanAccionInput,
  type PlanAccion,
  type SemaforoCounts,
} from '../api/trackingApi'
import {
  listNodoOptions,
  listPersonaOptions,
  type NodoPickerItem,
  type PersonaPickerItem,
} from '../api/trackingPickers'
import PlanDeAccionForm from '../components/PlanDeAccionForm'
import PlanesAccionTable from '../components/PlanesAccionTable'
import SemaforoSummary from '../components/SemaforoSummary'
import { SEMAFORO_ORDER, semaforoPresentation, toSemaforoEstado } from '../semaforo'
import { canCreatePlan, readTrackingClaims } from '../trackingAccess'

/**
 * `/tracking/planes` — every plan this caller may see, and the door to creating one.
 *
 * ## What "every plan this caller may see" means
 *
 * Nothing on this page decides that. `PlanesAccionEndpoints.ListAsync` scopes the
 * query itself: an admin gets the tenant, and everyone else gets
 * `NodoExternalId == theirs OR ResponsableEjecucion == them OR involucrados
 * contains them`. So this page asks for the list and renders what comes back —
 * there is no client-side filter standing between a role and its data, which is
 * the only arrangement where the UI cannot disagree with the service.
 *
 * ## The counts are computed here, not fetched
 *
 * `GET /api/tablero-seguimiento` also returns `conteos`, but that endpoint is the
 * **tablero**, and the tablero is the node leader's: it 403s a non-admin asking
 * about any node but their own, and it answers for exactly one node. This listing
 * spans whatever set the caller can see, so its summary has to be derived from
 * that set. Calling the tablero here would give a leader a red count for their own
 * node beside a table that also holds plans they are merely involved in.
 *
 * ## Creating without a `/tracking/planes/nuevo` route
 *
 * The create form lives on this page, behind a button, as well as in
 * `PlanDeAccionCreatePage`. The routes for this feature are owned by a sibling
 * slice and are `/tracking/planes`, `/tracking/planes/:id` and
 * `/tracking/mis-tareas` — no create route among them — so hosting the form here
 * is what makes creation actually reachable today. Both render the same
 * `PlanDeAccionForm`, so there is one form and not two.
 */
/**
 * The "no estado filter" sentinel.
 *
 * Not `''`: Radix's `Select` treats the empty string as "nothing is selected" and
 * will not accept it as an item value, so the trigger renders blank and the option
 * cannot be chosen. Not a real `EstadoSemaforo` either, so it can never be sent to
 * `ListAsync` by accident — `Enum.TryParse` would reject it there anyway, but a
 * value that cannot be confused for a state is better than one that relies on the
 * server refusing it.
 */
const ALL_ESTADOS = 'todos'

export default function PlanesAccionListPage() {
  const { t } = useTranslation()
  const scope = useCompanyScope()
  const companyId = scope.companyId
  const claims = useMemo(() => readTrackingClaims(), [])

  const [plans, setPlans] = useState<PlanAccion[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // `ALL_ESTADOS`, not `''`. Radix's `Select` reserves the empty string to mean
  // "no value chosen" and refuses it as an item value, so an "all states" option
  // written as `value: ''` renders a blank, unselectable trigger — which is exactly
  // what the first screenshot of this page showed. The sentinel is translated back
  // to "send no `estado` parameter" at the fetch.
  const [estado, setEstado] = useState(ALL_ESTADOS)

  const [nodos, setNodos] = useState<NodoPickerItem[]>([])
  const [personas, setPersonas] = useState<PersonaPickerItem[]>([])
  const [directoryUnavailable, setDirectoryUnavailable] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [created, setCreated] = useState<PlanAccion | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      // `undefined` for the baseUrl so the client uses its own
      // `getTrackingApiBaseUrl()` default — see the note at the top of `trackingApi.ts`.
      setPlans(
        await listPlanesAccion(undefined, {
          estado: estado === ALL_ESTADOS ? undefined : estado,
        }),
      )
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [estado, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // The directory is a separate, deliberately silent lookup. It feeds the create
  // form only, and `TrackingPickerEndpoints` refuses every role but the two admin
  // ones — so a leader gets a 403 here as a matter of course. Blanking the listing
  // over that would take the whole page down for the role the page most exists for.
  const loadDirectory = useCallback(async () => {
    if (!companyId) return
    try {
      const [nodoItems, personaItems] = await Promise.all([
        listNodoOptions(companyId),
        listPersonaOptions(companyId),
      ])
      setNodos(nodoItems)
      setPersonas(personaItems)
      setDirectoryUnavailable(false)
    } catch {
      setNodos([])
      setPersonas([])
      setDirectoryUnavailable(true)
    }
  }, [companyId])

  useEffect(() => {
    void loadDirectory()
  }, [loadDirectory])

  const counts = useMemo<SemaforoCounts>(() => {
    const tally = { rojo: 0, amarillo: 0, verde: 0 }
    for (const plan of plans) {
      const known = toSemaforoEstado(plan.estadoSemaforo)
      if (known === 'Rojo') tally.rojo += 1
      else if (known === 'Amarillo') tally.amarillo += 1
      else if (known === 'Verde') tally.verde += 1
    }
    return tally
  }, [plans])

  const estadoOptions = useMemo(
    () => [
      { value: ALL_ESTADOS, label: t('tracking.filters.allStates') },
      ...SEMAFORO_ORDER.map((value) => ({
        value,
        label: t(semaforoPresentation(value).labelKey),
      })),
    ],
    [t],
  )

  async function handleCreate(input: CreatePlanAccionInput) {
    setCreating(true)
    setCreateError(null)
    try {
      const plan = await createPlanAccion(input)
      setCreated(plan)
      setShowCreate(false)
      await reload()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setCreating(false)
    }
  }

  const mayCreate = canCreatePlan(claims)

  return (
    <div className="flex flex-col gap-6">
      <PageTopBar
        title={t('tracking.planes.title')}
        description={t('tracking.planes.description')}
        actions={
          mayCreate ? (
            <Button
              variant="primary"
              onClick={() => {
                setCreated(null)
                setCreateError(null)
                setShowCreate((open) => !open)
              }}
            >
              {showCreate ? t('common.cancel') : t('tracking.actions.newPlan')}
            </Button>
          ) : undefined
        }
      />

      {created && (
        <Alert variant="success">
          <AlertDescription>
            {t('tracking.planes.created', { code: created.planCode })}
          </AlertDescription>
        </Alert>
      )}

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle>{t('tracking.actions.createPlan')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PlanDeAccionForm
              claims={claims}
              nodos={nodos}
              personas={personas}
              directoryUnavailable={directoryUnavailable}
              submitting={creating}
              error={createError}
              onSubmit={(input) => void handleCreate(input)}
              onCancel={() => setShowCreate(false)}
            />
          </CardContent>
        </Card>
      )}

      <SemaforoSummary counts={counts} />

      <Card>
        <CardHeader>
          <CardTitle>{t('tracking.planes.listTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SelectField
            label={t('tracking.filters.estado')}
            options={estadoOptions}
            value={estado}
            onChange={setEstado}
          />

          {loadError ? (
            <NetworkError
              title={t('errors.generic')}
              description={loadError}
              onRetry={() => void reload()}
              retryText={t('common.retry')}
            />
          ) : (
            <LoadingRegion loading={loading} label={t('common.loading')}>
              {loading ? (
                <SkeletonText lines={4} />
              ) : (
                <PlanesAccionTable plans={plans} emptyMessage={t('tracking.planes.empty')} />
              )}
            </LoadingRegion>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
