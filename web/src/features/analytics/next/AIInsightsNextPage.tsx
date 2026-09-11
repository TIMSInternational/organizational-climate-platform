import { ShieldCheck, Sparkles } from 'lucide-react'
import { PageTopBar } from '../../../components/layout'
import { Alert, AlertDescription, Button, Chip, ErrorState, LoadingRegion, SkeletonText, EmptyState, Table } from '../../../components/ui'
import { useViewerCapabilities } from '../../../auth/viewerCapabilities'
import { useCompanyScope } from '../../../company-context'
import { useCompanyName } from '../../../company-context/useCompanyName'
import { useTranslation } from '../../../i18n'
import { insightPriorityLabel, insightTypeLabel } from '../insightVocabulary'
import { EmptyRow, Note, PanelHeading, TABLE_CARD_CLASS, TH_CLASS } from '../../shared-next/parts'
import { useAIInsightsModel } from './useAnalyticsModels'
import { priorityTone } from './model'

/**
 * Información de IA, redesigned (canvas board "AIInsights").
 *
 * A prioritised list — critical first — whose one verb is "mark as reviewed". The server
 * lets a super administrator, or the company administrator of the insight's own company,
 * acknowledge (`AIInsightEndpoints.cs` → `CanAccess`); that is `canManageOrg` exactly, so
 * the button is offered on that capability and nowhere else.
 *
 * The empty state names why it is empty. The only producer of `AIInsight` rows today is
 * the admin `POST /admin/ai-insights` (`AIInsightEndpoints.cs:162`) — nothing generates
 * them — so "the analysis is not configured" is the measured reason, not a guess.
 *
 * The previous screen, `pages/AIInsightsPage.tsx`, stays in the tree as the wiring
 * reference for the detail panel; the router no longer mounts it.
 */

export default function AIInsightsNextPage() {
  const { t } = useTranslation()
  const scope = useCompanyScope()
  const caps = useViewerCapabilities()
  const companyName = useCompanyName()
  const { state, reload, acknowledge, acknowledgingId, actionError } = useAIInsightsModel(scope.companyId)
  const company = companyName ?? t('insights.next.thisCompany')

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

  const insights = state.status === 'ready' ? state.data : []

  return (
    <div>
      <PageTopBar
        eyebrow={[t('insights.next.proposal'), companyName].filter(Boolean).join(' · ')}
        title={t('insights.next.title')}
        description={t('insights.next.description')}
      />

      <PanelHeading
        title={t('insights.next.heading')}
        count={state.status === 'ready' ? insights.length : undefined}
        aside={t('insights.next.order')}
      />

      {actionError && (
        <Alert variant="destructive" role="alert" className="mb-3">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {state.status === 'loading' ? (
        <LoadingRegion loading label={t('common.loading')}>
          <SkeletonText lines={4} />
        </LoadingRegion>
      ) : state.status === 'failed' ? (
        <ErrorState
          title={t('insights.next.loadFailed')}
          description={state.message}
          action={
            <Button variant="outline" onClick={() => void reload()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <div className={TABLE_CARD_CLASS}>
          <Table className="w-full border-collapse text-sm">
            <thead className="border-b border-line-light">
              <tr>
                <th scope="col" className={`${TH_CLASS} w-28`}>{t('insights.next.colPriority')}</th>
                <th scope="col" className={TH_CLASS}>{t('insights.next.colFinding')}</th>
                <th scope="col" className={`${TH_CLASS} w-36`}>{t('insights.next.colType')}</th>
                <th scope="col" className={`${TH_CLASS} w-40`}>{t('insights.next.colCategory')}</th>
                <th scope="col" className={`${TH_CLASS} w-44`}>
                  <span className="sr-only">{t('insights.next.colReview')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {insights.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-0">
                    <EmptyRow
                      icon={<Sparkles />}
                      title={t('insights.next.emptyTitle')}
                      lines={[
                        t('insights.next.emptyReason', { company }),
                        t('insights.next.emptyNext'),
                      ]}
                    />
                  </td>
                </tr>
              ) : (
                insights.map((insight) => (
                  <tr key={insight.id} data-testid="insight-row" className="border-b border-line-light last:border-b-0">
                    <td className="px-3 py-2.5 align-top">
                      <Chip tone={priorityTone(insight.priority)} label={insightPriorityLabel(t, insight.priority)} />
                    </td>
                    <td className="px-3 py-2.5 align-top text-fg-primary">{insight.title}</td>
                    <td className="px-3 py-2.5 align-top text-fg-secondary">{insightTypeLabel(t, insight.type)}</td>
                    <td className="px-3 py-2.5 align-top text-fg-secondary">{insight.category}</td>
                    <td className="px-3 py-2.5 text-right align-top">
                      {insight.isAcknowledged ? (
                        <Chip tone="good" label={t('insights.next.acknowledged')} />
                      ) : caps.canManageOrg ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={acknowledgingId !== null}
                          onClick={() => void acknowledge(insight.id)}
                        >
                          {t('insights.next.acknowledge')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      )}

      <Note icon={<ShieldCheck />} className="mt-panel-gap">
        {t('insights.next.privacy')}
      </Note>
    </div>
  )
}
