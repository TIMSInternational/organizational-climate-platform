import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getConsolidado, type ConsolidadoResponse, type NodoConsolidado } from '../api/trackingApi'
import { getNodoNames } from '../api/trackingPickers'
import { SemaforoGlyph } from '../components/SemaforoChip'
import SemaforoSummary from '../components/SemaforoSummary'
import { SEMAFORO_ORDER, semaforoCount, semaforoPresentation } from '../semaforo'
import { canViewConsolidado } from '../trackingAccess'
import { formatPercentOrUnavailable, percentagePoints } from '../trackingUnits'
import { useCompanyScope } from '../../../company-context'
import { useCompanyName } from '../../../company-context/useCompanyName'
import { getToken } from '../../../auth/token'
import { decodeJwtPayload } from '../../../auth/jwt'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import {
  Caption,
  EmptyState,
  ErrorState,
  LoadingRegion,
  NetworkError,
  SkeletonText,
  Table,
} from '../../../components/ui'

/**
 * `GET /consolidado` widened by the one field #125 says renders here.
 *
 * `NodoConsolidado` today is `(NodoExternalId, Conteos, TotalPlanes)` — no
 * prior-year figure anywhere in `DashboardDtos.cs`, and none in
 * `ConsolidadoResponse` either. `resultado_anio_anterior_pct` lives on
 * `HallazgoDto` (`decimal?`), which the dashboards do not join to, and #89 is the
 * issue that makes it resolve at all.
 *
 * So the column reads an OPTIONAL field: absent today, populated the moment the
 * service adds it, with no page change. That is deliberately not the same as
 * inventing the field — `formatPercentOrUnavailable` renders absent and null
 * identically, as "not available", and the note under the table says why in the
 * reader's own language rather than leaving a column of dashes to be interpreted.
 */
type NodoRow = NodoConsolidado & { resultadoAnioAnteriorPct?: number | null }

/**
 * The consolidated tracking board: every nodo's action plans, by semáforo.
 *
 * ## What is on this screen, and why nothing here can identify a person
 *
 * `GET /api/consolidado` returns exactly two things (`DashboardEndpoints.ConsolidadoAsync`):
 * company-wide semáforo counts, and one row per nodo carrying that nodo's counts
 * and its plan total. There is no survey answer, no score, no respondent and no
 * persona id anywhere in the payload — these are **action plans**, which are
 * assignments a jefatura made, not anybody's responses. The client's §7 rule
 * ("nunca respuestas individuales; los resultados de origen agregados por nodo") is
 * therefore satisfied structurally rather than by suppression: there is nothing on
 * this screen to suppress.
 *
 * The one place that could go wrong is the drill-in, so it is pinned:
 * `ConsolidadoPage.test.tsx` asserts that every link a nodo row offers goes to that
 * nodo's own aggregate board and nowhere deeper.
 *
 * What this page CANNOT check is the ≥5-collaborator floor that makes a jefatura a
 * nodo. `NodoDto.CantidadColaboradores` exists in the tracking service's cache and
 * is not in `NodoConsolidado`, so the browser never learns a nodo's headcount. That
 * floor is a property of how nodos are defined upstream, and this page neither
 * enforces nor undermines it.
 *
 * ## Admin-only, and it says so rather than showing a 403
 *
 * `ConsolidadoAsync` returns `Results.Forbid()` for anything outside `Roles.Admin`.
 * The nav never offers this row to another role, but the URL is typeable, so the
 * page checks the claim itself and declines before making a request that could only
 * fail. The alternative — let it 403 — renders "Request failed: 403" to an audience
 * §7 describes as having low digital literacy, which is not an error message.
 */
export default function ConsolidadoPage() {
  const { t, locale } = useTranslation()
  const companyName = useCompanyName()
  const scope = useCompanyScope()
  const companyId = scope.companyId

  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  const allowed = canViewConsolidado(role)

  const [data, setData] = useState<ConsolidadoResponse | null>(null)
  const [nodoNames, setNodoNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  /**
   * The one request this page depends on.
   *
   * Everything inside the `try` matters for #125's fifth criterion. `authFetch`
   * throws on any non-2xx and `fetch` itself rejects when the tracking origin is
   * simply not there — a service that is down, a DNS name that does not resolve, or
   * a CORS preflight the tracking deployment has not been configured to allow. All
   * of those land here as a rejection, and all of them have to leave the shell, the
   * header and a retry on screen instead of an error boundary. `setData(null)` is
   * part of that: a retry that fails must not leave the previous good table up under
   * an error message.
   */
  const reload = useCallback(async () => {
    if (!allowed) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      setData(await getConsolidado())
    } catch (err) {
      setData(null)
      setLoadError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [allowed, t])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * Nodo names, and a failure here is deliberately silent.
   *
   * The board is readable without them — every row falls back to the external id —
   * and blanking a whole consolidated view because a *label* lookup was unreachable
   * would be much the worse outcome. `/tracking/picker/nodos` is on the main API,
   * not on the tracking service, so it is also the half that keeps working when the
   * tracking service is the thing that is down.
   */
  const loadNames = useCallback(async () => {
    if (!allowed || !companyId) return
    try {
      setNodoNames(await getNodoNames(companyId))
    } catch {
      setNodoNames(new Map())
    }
  }, [allowed, companyId])

  useEffect(() => {
    void loadNames()
  }, [loadNames])

  if (!allowed) {
    return (
      <ErrorState
        title={t('tracking.consolidadoRestrictedTitle')}
        description={t('tracking.consolidadoRestrictedBody')}
      />
    )
  }

  const rows: NodoRow[] = data?.porNodo ?? []
  /**
   * The company's plan total according to the ROWS, which is the figure the table
   * below actually shows. `ConsolidadoResponse` has no company-level `totalPlanes`
   * — only `conteos` and the per-nodo rows — so this is the only server-derived
   * total on the page, and it is what the strip is checked against.
   */
  const serverTotal = rows.reduce((sum, nodo) => sum + nodo.totalPlanes, 0)

  return (
    <div>
      {/* Title from the nav catalogue and the longer line from `tracking.*`, the
          same split `ActionPlansListPage` uses: the nav blurb has to fit a 151px
          rail row, and this header is where the screen gets to say what it is
          aggregating and what it never shows. Both keys already existed —
          `navigation.trackingConsolidado` shipped with the legacy port and had no
          caller until now. */}
      <PageTopBar
        eyebrow={companyName}
        title={t('navigation.trackingConsolidado')}
        description={t('tracking.consolidadoDescription')}
      />

      {/* The strip is company-wide `conteos`, which the server totals over every
          plan rather than over the rows below — so it stays correct even for a
          company whose plans are all in one nodo. Hidden while loading and on
          failure: a strip of zeros is a reading nobody took.

          `total` is the sum of the rows' own `totalPlanes`, and passing it is what
          lets the strip NOTICE a disagreement rather than paper over one.
          `CountSemaforo` tallies three states and `TotalPlanes` is `g.Count()` over
          the same group; they agree only while `EstadoSemaforo` has exactly three
          members. Give it a fourth and the KPI row would read 9 above a table
          reading 10, with neither number wrong and nothing to flag it. See
          `countsCoverTotal`. */}
      {!loading && !loadError && data && (
        <SemaforoSummary counts={data.conteos} total={serverTotal} locale={locale} />
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
          ) : rows.length === 0 ? (
            <EmptyState
              fill
              title={t('tracking.consolidadoEmptyTitle')}
              description={t('tracking.consolidadoEmptyBody')}
            />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <th>{t('tracking.columnNodo')}</th>
                    <th>{t('tracking.columnTotalPlanes')}</th>
                    {/* One column per state, headed by its own silhouette as well as
                        its word. The header is where a reader learns which outline
                        means what, so a bare word here would leave the chips
                        elsewhere in the module unexplained.

                        `SemaforoGlyph` rather than a whole `SemaforoChip`: three
                        filled pills in a table head read as three controls sitting
                        on the data, and repeat the pills in the strip immediately
                        above. The glyph still comes from the ONE icon map — this
                        heading previously reached into a second presentation record
                        for a raw icon component, which is what let the strip and
                        the rows disagree about whether a state has a shape. */}
                    {SEMAFORO_ORDER.map((estado) => (
                      <th key={estado}>
                        <span className="inline-flex items-center gap-1">
                          <SemaforoGlyph estado={estado} className="size-3.5" />
                          {t(semaforoPresentation(estado).labelKey)}
                        </span>
                      </th>
                    ))}
                    <th>{t('tracking.columnPriorYear')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((nodo) => (
                    <tr key={nodo.nodoExternalId}>
                      <td>
                        {/* The drill-in, and the deepest this screen goes: one
                            nodo's aggregate board. Never a person, never an
                            answer. */}
                        <Link
                          to={`/tracking/tablero?nodoId=${encodeURIComponent(nodo.nodoExternalId)}`}
                          className="font-semibold"
                        >
                          {nodoNames.get(nodo.nodoExternalId) ?? nodo.nodoExternalId}
                        </Link>
                      </td>
                      <td className="font-mono tabular-nums">{nodo.totalPlanes}</td>
                      {SEMAFORO_ORDER.map((estado) => (
                        <td key={estado} className="font-mono tabular-nums">
                          {semaforoCount(nodo.conteos, estado)}
                        </td>
                      ))}
                      <td className="font-mono tabular-nums text-fg-secondary">
                        {formatPercentOrUnavailable(
                          nodo.resultadoAnioAnteriorPct,
                          t('tracking.priorYearUnavailable'),
                          locale,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {/* Why the column reads "not available" rather than a number. Said
                  once under the table instead of as a tooltip per cell: this
                  audience should not have to hover to find out that a blank is
                  not a zero.

                  Conditional, and that is the point. The note asserts the figure is
                  UNAVAILABLE; printed unconditionally it would keep saying so
                  underneath a column of real percentages the moment #89 lands and
                  the service starts populating `resultadoAnioAnteriorPct` — the
                  page contradicting itself, in the one place a reader would go to
                  resolve the contradiction. It appears while at least one cell has
                  no reading and disappears by itself when they all do. */}
              {rows.some((nodo) => percentagePoints(nodo.resultadoAnioAnteriorPct) === null) && (
                <Caption className="mt-panel-gap block text-fg-secondary">
                  {t('tracking.priorYearNote')}
                </Caption>
              )}
            </>
          )}
        </LoadingRegion>
      )}
    </div>
  )
}
