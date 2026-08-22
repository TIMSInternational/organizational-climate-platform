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
 * ## Read-only, and it says so
 *
 * `PlanAccessHandler` gives an involucrado — and the responsable de ejecución —
 * `AccessLevel.Read` and nothing more. Recording progress belongs to the node's
 * leader. So this page offers no write control of any kind and states who to go to
 * instead, rather than showing buttons that would 403. Rows still link into the
 * detail page, which shows its own read-only face to the same viewer.
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
            <AlertDescription>{t('tracking.misTareas.readOnly')}</AlertDescription>
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
