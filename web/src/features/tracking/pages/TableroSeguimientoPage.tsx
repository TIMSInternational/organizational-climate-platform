import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { getTablero, type TableroResponse } from '../api/trackingApi'
import { getTrackingApiBaseUrl } from '../api/config'
import { getNodoNames } from '../api/trackingPickers'
import SemaforoChip from '../components/SemaforoChip'
import SemaforoSummary from '../components/SemaforoSummary'
import { canCreatePlan, canViewConsolidado, canViewTablero, readTrackingClaims } from '../trackingAccess'
import { formatPercentOrUnavailable } from '../trackingUnits'
import { useCompanyScope } from '../../../company-context'
import { getToken } from '../../../auth/token'
import { decodeJwtPayload } from '../../../auth/jwt'
import { calendarDay } from '../../../lib/calendarDay'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingRegion,
  NetworkError,
  SkeletonText,
  Table,
} from '../../../components/ui'

/**
 * One jefatura's tracking board: its semáforo, and every action plan in it.
 *
 * ## Whose board this is
 *
 * `DashboardEndpoints.TableroAsync` reads `nodoId ?? currentUser.NodoExternalId`
 * and refuses a *non-admin* who names a nodo other than their own. So there are
 * exactly two ways onto this screen:
 *
 * - a node leader, with no `?nodoId` — the server hands them their own jefatura;
 * - an administrator who arrived from the consolidado, carrying that nodo's id.
 *
 * An administrator with no `?nodoId` is the third case and it is a dead end rather
 * than an error: their own `nodoId` claim is `unassigned-<companyId>` at best and
 * empty at worst (`TrackingIdentifiers.NodoIdClaimForUser` returns null for a
 * company-less super_admin), so the board would come back empty and say nothing
 * about why. They are sent back to the consolidado to choose, which is the same
 * "ask rather than guess" shape `useCompanyScope` uses for the company.
 *
 * ## Why the role check here is a product rule and not protection
 *
 * See `trackingAccess.ts`. In short: the client's §7 says the full board belongs to
 * the node leader and `involucrados` get the task view, but `TableroAsync` enforces
 * *nodo* membership rather than role, so any authenticated member of the jefatura
 * can call the endpoint directly. This page implements the product rule; it does
 * not — and cannot — close that gap from the browser.
 *
 * ## No person's name is on this screen
 *
 * `PlanResponse` carries `responsableEjecucionExternalId` and
 * `involucradosExternalIds`, and neither is rendered here. Two reasons, and the
 * second is the deciding one:
 *
 * - the payload has ids, not names, and the endpoint that resolves them
 *   (`/tracking/picker/personas`) admits only `super_admin` and a company's own
 *   `company_admin` — so for the leader who owns this board it would 403 every
 *   time, and the column would be a row of GUIDs for the exact reader §7 is about;
 * - the who-does-what belongs to a plan, and a plan has its own screen (#126's
 *   `/tracking/planes/:id`). This one is a board: state, deadline, progress.
 */
export default function TableroSeguimientoPage() {
  const { t, locale } = useTranslation()
  const [searchParams] = useSearchParams()
  const scope = useCompanyScope()
  const companyId = scope.companyId

  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  const allowed = canViewTablero(role)
  const isAdmin = canViewConsolidado(role)
  // The same predicate `PlanesAccionListPage` gates its "Nuevo plan" button on, asked
  // here so the two screens cannot disagree about whether this reader may create a plan.
  // `readTrackingClaims()` rather than the payload decoded above: it is the module's one
  // reader of `sub`/`role`/`nodoId`, and `canCreatePlan` needs the node.
  const mayCreate = canCreatePlan(readTrackingClaims())

  // Trimmed and normalised to null: `?nodoId=` with nothing after it is not a
  // choice, and passing the empty string would ask the server for the nodo whose
  // id is "" rather than for the caller's own.
  const nodoId = searchParams.get('nodoId')?.trim() || null
  // An administrator has no board of their own — see the component note.
  const needsNodo = isAdmin && nodoId === null

  const [data, setData] = useState<TableroResponse | null>(null)
  const [nodoNames, setNodoNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  /**
   * `getTablero` takes `baseUrl` FIRST and `nodoId` second, so the default cannot
   * be relied on here — passing the nodo means passing the base URL explicitly.
   * (That ordering is the opposite of this repo's "optional params last" rule; the
   * client is #124's and is deliberately not rewritten by #125.)
   *
   * The `catch` is #125's fifth criterion: an unreachable tracking service, a CORS
   * preflight its deployment has not been configured to allow, or any non-2xx, all
   * arrive here as a rejection and all must leave the shell and a retry on screen.
   */
  const reload = useCallback(async () => {
    if (!allowed || needsNodo) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      setData(await getTablero(getTrackingApiBaseUrl(), nodoId ?? undefined))
    } catch (err) {
      setData(null)
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [allowed, needsNodo, nodoId, t])

  useEffect(() => {
    void reload()
  }, [reload])

  // Names are an administrator's affordance: the picker 403s for a leader, so this
  // resolves for the role that navigated here by id and stays silently empty for
  // the role that did not need it. A failure costs a label and never the board.
  const loadNames = useCallback(async () => {
    if (!isAdmin || !companyId) return
    try {
      setNodoNames(await getNodoNames(companyId))
    } catch {
      setNodoNames(new Map())
    }
  }, [isAdmin, companyId])

  useEffect(() => {
    void loadNames()
  }, [loadNames])

  if (!allowed) {
    return (
      <ErrorState
        title={t('tracking.tableroRestrictedTitle')}
        description={t('tracking.tableroRestrictedBody')}
      />
    )
  }

  const shownNodoId = data?.nodoExternalId ?? nodoId
  const nodoName = shownNodoId ? nodoNames.get(shownNodoId) : undefined
  // The name when it resolved; otherwise the id, but only for the administrator who
  // navigated here BY that id and needs to confirm which board they are on. A
  // leader is on their own board by definition and gains nothing from a GUID.
  const nodoLabel = nodoName ?? (isAdmin ? shownNodoId : null)

  return (
    <div>
      {/* Title and line both from `tracking.*` — see `ConsolidadoPage` for why the
          module titles itself in its own language rather than reaching into the
          translated `navigation` namespace. The eyebrow is the nodo rather than the nav
          section, because which board this is matters more than which group it sits in. */}
      <PageTopBar
        eyebrow={nodoLabel}
        title={t('tracking.tableroTitle')}
        description={t('tracking.tableroDescription')}
      />

      {needsNodo ? (
        <EmptyState
          fill
          title={t('tracking.tableroChooseNodoTitle')}
          description={t('tracking.tableroChooseNodoBody')}
          action={<Link to="/tracking">{t('tracking.tableroBackToConsolidado')}</Link>}
        />
      ) : (
        <>
          {!loading && !loadError && data && (
            <SemaforoSummary counts={data.conteos} locale={locale} />
          )}

          {loadError ? (
            <NetworkError
              title={t('tracking.serviceUnavailableTitle')}
              description={t('tracking.serviceUnavailableBody')}
              onRetry={reload}
              retryText={t('common.retry')}
            />
          ) : (
            <LoadingRegion loading={loading} label={t('common.loading')}>
              {loading ? (
                <SkeletonText lines={4} />
              ) : (data?.planes.length ?? 0) === 0 ? (
                <EmptyState
                  fill
                  title={t('tracking.tableroEmptyTitle')}
                  description={t('tracking.tableroEmptyBody')}
                  // A door, for the one reader who can open it.
                  //
                  // Photographed as a leader against a node with no plans: this state
                  // was the whole screen, and it said "todavía no se ha registrado
                  // ningún plan de acción para este nodo" to the very person whose job
                  // §7 says that is — with nothing to click. A node leader's first
                  // visit to their own board is precisely the moment it is empty, so
                  // the emptiest version of this page was the one that helped least.
                  //
                  // `/tracking/planes` and not a form: creation lives there (see
                  // `PlanesAccionListPage`'s note on why there is no `/nuevo` route),
                  // it is in this role's `ROLE_CAPABILITIES` entry, and
                  // `PlanesAccionEndpoints.ListAsync` scopes it server-side — so this
                  // is a destination the reader provably loads rather than a button
                  // that would come back 403, which is the mistake #138 was opened for.
                  //
                  // Gated on `canCreatePlan` rather than on the role, because a caller
                  // whose `nodoId` claim is blank passes the role check and is then
                  // refused on every node they could pick. They get the plain empty
                  // state, which is the true one for them.
                  //
                  // A `Button asChild variant="primary"` and not a bare `<Link>`, and
                  // that is a measurement rather than a taste. Measured off
                  // `styles/tokens.css`: `--admin-accent-blue` #0d9488 as ink on this
                  // page's white card is **3.74:1** — under WCAG AA's 4.5:1 for normal
                  // text — while it is 6.05:1 in dark, so a link styled the usual way
                  // would have been another of this repo's light-only contrast bugs.
                  // The primary button is `--admin-accent-blue-fill` #0f766e under
                  // `--admin-font-on-accent` #ffffff, the pairing `accentContrast.test.ts`
                  // measures at 5.47:1 in *both* themes. It also matches how
                  // `PlanesAccionListPage` draws the same action, so a reader meets one
                  // control for one job.
                  action={
                    mayCreate ? (
                      <Button asChild variant="primary">
                        <Link to="/tracking/planes">{t('tracking.actions.createPlan')}</Link>
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>{t('tracking.columnPlan')}</th>
                      <th>{t('tracking.columnQue')}</th>
                      <th>{t('tracking.columnCompromiso')}</th>
                      <th>{t('tracking.columnUltimaActualizacion')}</th>
                      <th>{t('tracking.columnAvance')}</th>
                      <th>{t('tracking.columnEstado')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.planes ?? []).map((plan) => (
                      <tr key={plan.id}>
                        {/* A link now. `/tracking/planes/:id` is registered in
                            `app/router.tsx` since #125 and #126 were reconciled —
                            before that it was plain text, because a row whose code
                            links to the error boundary is worse than one that does
                            not link at all. `router.test.ts` is what keeps that
                            true. */}
                        <td className="font-mono tabular-nums font-semibold">
                          <Link to={`/tracking/planes/${plan.id}`} className="text-accent-blue">
                            {plan.planCode}
                          </Link>
                        </td>
                        <td>{plan.descripcionQue}</td>
                        <td className="font-mono tabular-nums text-fg-secondary">
                          {calendarDay(Date.parse(plan.fechaCompromiso), locale)}
                        </td>
                        {/* On screen because it is half of why a plan is red:
                            `RecalcularSemaforo` turns a board red on
                            `diasSinActualizar > DiasRojoSinActualizar` regardless
                            of progress, and a leader looking at a red row needs to
                            see that it is staleness rather than the deadline. */}
                        <td className="font-mono tabular-nums text-fg-secondary">
                          {calendarDay(Date.parse(plan.fechaUltimaActualizacion), locale)}
                        </td>
                        {/* `porcentajeAvance` is stored 0–1. `formatPercentOrUnavailable`
                            is the only thing on these screens that multiplies. */}
                        <td className="font-mono tabular-nums">
                          {formatPercentOrUnavailable(
                            plan.porcentajeAvance,
                            t('tracking.avanceUnavailable'),
                            locale,
                          )}
                        </td>
                        <td>
                          <SemaforoChip estado={plan.estadoSemaforo} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </LoadingRegion>
          )}
        </>
      )}
    </div>
  )
}
