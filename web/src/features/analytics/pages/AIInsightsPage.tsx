import { useCallback, useEffect, useState } from 'react'
import {
  acknowledgeAIInsight,
  getAIInsight,
  listAIInsights,
  type AIInsight,
  type AIInsightListItem,
} from '../api/insights'
import InsightList from '../components/InsightList'
import InsightDetailPanel from '../components/InsightDetailPanel'
import { getUser } from '../../org-structure/api/users'
import { useCompanyScope } from '../../../company-context'
import { useTranslation } from '../../../i18n'
import { PageTopBar } from '../../../components/layout'
import { Button, EmptyState, ErrorState } from '../../../components/ui'

/**
 * List and acknowledge AI insights.
 *
 * ## What is actually behind this page today
 *
 * Nothing. `/admin/ai-insights` is **not mapped** — #86 (the AIInsight CRUD and
 * acknowledge endpoints) is open, and #92 (the generation that would fill it) is
 * open behind it. Every call this page makes 404s on `main` right now. The page
 * is written against the contract `features/analytics/api/insights.ts` pins,
 * which is transcribed from #86's planned `AIInsightDtos.cs` and cross-checked
 * against the `AIInsight` entity, which does exist. See that file's header.
 *
 * That is also why the two "nothing to show" paths are kept apart:
 *
 * - **A 200 with an empty array** is the state #92 leaves behind before anything
 *   has been generated. That is an `EmptyState` — nothing is wrong.
 * - **A failed request** is an `ErrorState` with a retry. Rendering a 404 as an
 *   empty list would tell an admin their company has no findings, when what
 *   actually happened is that the feature is not deployed. That is a worse lie
 *   than an error message, and it is the specific failure this split exists to
 *   avoid.
 *
 * ## What is deliberately absent
 *
 * No generation trigger, no "regenerate", no sentiment or attrition surface. #67
 * — the AI provider decision, and whether predictive attrition survives at all —
 * is undecided, so anything of that shape here would be a button wired to a
 * decision nobody has made. Acknowledgement is the one verb #86 commits to, and
 * it is the only one this page offers.
 */
export default function AIInsightsPage() {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  // #124. The `''`-vs-missing normalisation this page used to do inline now lives
  // once, in `company-context/companyContext.ts`, along with the rule that a
  // SuperAdmin's company is their explicit selection and never their own claim.
  // That rule is what makes this page reachable for a super_admin at all --
  // `navSections.ts` withheld it precisely because there was nothing to ask for.
  const scope = useCompanyScope()
  const companyId = scope.companyId

  const [insights, setInsights] = useState<AIInsightListItem[]>([])
  const [selected, setSelected] = useState<AIInsight | null>(null)
  const [acknowledgerName, setAcknowledgerName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [acknowledging, setAcknowledging] = useState(false)

  const reload = useCallback(async () => {
    if (!companyId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setInsights(await listAIInsights(baseUrl, companyId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [baseUrl, companyId, t])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * Turns `acknowledgedBy` (a user id) into a name.
   *
   * A failed lookup is swallowed to `null` rather than surfaced: the insight
   * itself loaded fine, and a CompanyAdmin can legitimately be refused
   * `GET /admin/users/{id}` for an acknowledger outside their tenant. The panel
   * falls back to wording in that case instead of printing the raw id.
   */
  const resolveAcknowledger = useCallback(
    async (insight: AIInsight): Promise<string | null> => {
      if (!insight.acknowledgedBy) return null
      try {
        return (await getUser(baseUrl, insight.acknowledgedBy)).name
      } catch {
        return null
      }
    },
    [baseUrl],
  )

  async function open(id: string) {
    setDetailError(null)
    try {
      const detail = await getAIInsight(baseUrl, id)
      setSelected(detail)
      setAcknowledgerName(await resolveAcknowledger(detail))
    } catch (err) {
      setSelected(null)
      setAcknowledgerName(null)
      setDetailError(err instanceof Error ? err.message : t('insights.detailFailed'))
    }
  }

  async function acknowledge() {
    if (!selected) return
    setAcknowledging(true)
    setDetailError(null)
    try {
      const updated = await acknowledgeAIInsight(baseUrl, selected.id)
      setSelected(updated)
      setAcknowledgerName(await resolveAcknowledger(updated))
      // The list row's `isAcknowledged` is stale the moment the detail changes,
      // and the badge in the table is the only place most of these rows are ever
      // read, so refresh it rather than patching the one row in place.
      await reload()
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : t('insights.acknowledgeFailed'))
    } finally {
      setAcknowledging(false)
    }
  }

  if (scope.status === 'needs-selection') {
    return (
      <EmptyState
        title={t('companyContext.chooseACompany')}
        description={t('companyContext.chooseACompanyDescription')}
      />
    )
  }

  if (scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }

  return (
    <div>
      <PageTopBar title={t('navigation.aiInsights')} description={t('insights.description')} />

      {loading ? (
        <p>{t('common.loading')}</p>
      ) : error ? (
        <ErrorState
          title={t('insights.loadFailed')}
          description={error}
          action={
            <Button variant="outline" onClick={() => void reload()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : insights.length === 0 ? (
        <EmptyState
          title={t('insights.noInsights')}
          description={t('insights.noInsightsDescription')}
        />
      ) : (
        <>
          <InsightList insights={insights} selectedId={selected?.id ?? null} onSelect={(id) => void open(id)} />
          {detailError && <p role="alert">{detailError}</p>}
          {selected ? (
            <InsightDetailPanel
              insight={selected}
              acknowledgedByName={acknowledgerName}
              acknowledging={acknowledging}
              onAcknowledge={() => void acknowledge()}
            />
          ) : (
            <p>{t('insights.selectAnInsight')}</p>
          )}
        </>
      )}
    </div>
  )
}
