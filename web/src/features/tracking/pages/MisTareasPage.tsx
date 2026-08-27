import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageTopBar } from '../../../components/layout'
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  LoadingRegion,
  NetworkError,
  SkeletonText,
} from '../../../components/ui'
import { useTranslation } from '../../../i18n'
import { getMisTareas, type PlanAccion, type SemaforoCounts } from '../api/trackingApi'
import PlanesAccionTable from '../components/PlanesAccionTable'
import SemaforoSummary from '../components/SemaforoSummary'
import { tallySemaforo } from '../semaforo'
import { canManagePlan, readTrackingClaims } from '../trackingAccess'

/**
 * `/tracking/mis-tareas` — the task-only view.
 *
 * ## The one genuinely non-admin page in this feature
 *
 * `DashboardEndpoints.MisTareasAsync` reads **no role claim at all**. It filters on
 * `ResponsableEjecucionExternalId == currentUser.PersonaExternalId` or the caller's
 * id appearing in `_involucradosExternalIds`, which is a statement about the
 * person, not about their rank. So an `employee`, a `supervisor` and a `leader` can
 * all load this and all get their own list — which is what makes it safe to put in
 * a role-aware nav for roles that have almost nothing else to reach.
 *
 * Contrast `/api/tablero-seguimiento`, which `Forbid`s a non-admin asking about any
 * node but their own, and `/api/consolidado`, which `Forbid`s every non-admin
 * outright. **The full tablero is the node leader's; this is everyone else's.**
 * That is the whole reason this page exists separately from the listing rather
 * than being a filter on it.
 *
 * ## Read-only, and it says so — but not the same sentence to everybody
 *
 * `PlanAccessHandler` gives an involucrado — and the responsable de ejecución —
 * `AccessLevel.Read` and nothing more. Recording progress belongs to the node's
 * leader. So this page offers no write control of any kind and states who to go to
 * instead, rather than showing buttons that would 403. Rows still link into the
 * detail page, which shows its own read-only face to the same viewer.
 *
 * The notice used to be unconditional, and for one reader it was false. **A node
 * leader is a first-class caller here**: `MisTareasAsync` reads no role claim, so a
 * leader named as responsable or involucrado on a plan of their own jefatura gets it
 * in this list — and `canManagePlan` gives them write access to exactly that plan,
 * because `PlanAccessHandler` matches their `nodoId` claim against the plan's node.
 * Telling them "el registro de avance lo realiza la jefatura del nodo" names them,
 * and the detail page they land on one click later then shows them the
 * `RegistrarAvanceForm` the sentence just said was somebody else's. Photographed as
 * a leader on `nodo-operaciones`, against a fixture whose two tasks both sit on that
 * node: every word of the banner was wrong for that reader.
 *
 * So the page asks the same predicate the detail page asks. Nothing about what this
 * page *does* changes — there is still no write control here, which is the true half
 * of the sentence — only which of two true sentences the reader is given, and the
 * manager's version points at where their control actually is.
 *
 * ## No company scope
 *
 * Deliberately no `useCompanyScope()`. The endpoint resolves the caller from their
 * own token and takes no company parameter; a company picker on a page about "my"
 * tasks would imply this list could be somebody else's.
 */
export default function MisTareasPage() {
  const { t } = useTranslation()
  const [tareas, setTareas] = useState<PlanAccion[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setTareas(await getMisTareas())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void reload()
  }, [reload])

  // `tallySemaforo`, not a loop written out here. Two pages counted these three
  // states inline, which made two more copies of the state list — and an unknown
  // state is counted in none of them, so `total` is passed as well and the strip
  // discloses any shortfall rather than implying it counted everything.
  const counts = useMemo<SemaforoCounts>(() => tallySemaforo(tareas), [tareas])

  // Read once: the claims come from the stored token and do not change while the page
  // is mounted, and `readTrackingClaims()` decodes on every call.
  const claims = useMemo(() => readTrackingClaims(), [])
  // `some`, not `every`. A leader can hold a mixed list — a plan on their own node
  // beside one they were merely involved in elsewhere — and the sentence that would be
  // wrong for them is the one denying they may record any progress at all. Where they
  // can record some, the manager's line is the true one and the detail page draws the
  // per-plan boundary exactly.
  const managesAny = useMemo(
    () => tareas.some((plan) => canManagePlan(plan, claims)),
    [tareas, claims],
  )

  return (
    <div className="flex flex-col gap-6">
      <PageTopBar
        title={t('tracking.misTareas.title')}
        description={t('tracking.misTareas.description')}
      />

      <SemaforoSummary counts={counts} total={tareas.length} />

      <Card>
        <CardHeader>
          <CardTitle>{t('tracking.misTareas.listTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert variant="info">
            <AlertDescription>
              {t(
                managesAny
                  ? 'tracking.misTareas.readOnlyManager'
                  : 'tracking.misTareas.readOnly',
              )}
            </AlertDescription>
          </Alert>

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
                <PlanesAccionTable plans={tareas} emptyMessage={t('tracking.misTareas.empty')} />
              )}
            </LoadingRegion>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
