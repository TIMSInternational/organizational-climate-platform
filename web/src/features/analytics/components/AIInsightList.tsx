import type { AIInsightListItem } from '../api/insights'
import { useTranslation } from '../../../i18n'
import { Badge, Button, EmptyState, Table } from '../../../components/ui'
import { insightPriorityLabel } from '../insightVocabulary'

interface AIInsightListProps {
  insights: readonly AIInsightListItem[]
  /** Id currently being acknowledged, so the row can disable itself. */
  acknowledgingId?: string
  onAcknowledge: (insight: AIInsightListItem) => void
}

/**
 * The dashboard's insight table.
 *
 * The priority → catalogue-key map this file used to hold inline now lives in
 * `../insightVocabulary.ts`, shared with the `/analytics/ai-insights` list and detail
 * (#282). Two copies of one vocabulary is how two catalogues drift apart, which is the
 * argument the inline copy was already making. The reasoning it carried is preserved
 * there: the labels are reused from `actionPlans.*`, and an unrecognised priority renders
 * verbatim because the backend does not constrain the column.
 *
 * The badge is always `secondary`, for the reason measured and tabulated in
 * `features/reports/components/ReportList.tsx`: every hued badge variant fails WCAG AA
 * 1.4.3 in at least one theme (`warning` is 2.99:1 in light, `destructive` 3.76:1 in
 * dark), and `secondary` clears it in both at 8.15:1 / 6.85:1. The priority word carries
 * the meaning.
 */
export default function AIInsightList({
  insights,
  acknowledgingId,
  onAcknowledge,
}: AIInsightListProps) {
  const { t } = useTranslation()

  if (insights.length === 0) {
    return (
      <EmptyState
        title={t('analytics.noInsights')}
        description={t('analytics.noInsightsDescription')}
      />
    )
  }

  return (
    <Table>
      <thead>
        <tr>
          <th>{t('analytics.insight')}</th>
          <th>{t('analytics.category')}</th>
          <th>{t('analytics.priority')}</th>
          <th>{t('common.status')}</th>
          <th>{t('common.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {insights.map((insight) => (
          <tr key={insight.id}>
            <td>{insight.title}</td>
            <td>{insight.category}</td>
            <td>
              <Badge variant="secondary">{insightPriorityLabel(t, insight.priority)}</Badge>
            </td>
            <td>
              {insight.isAcknowledged ? t('analytics.acknowledged') : t('analytics.outstanding')}
            </td>
            <td>
              {/* There is no un-acknowledge verb on the API, so an acknowledged row
                  offers no button at all rather than a disabled one that implies a
                  toggle exists. */}
              {!insight.isAcknowledged && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={acknowledgingId === insight.id}
                  onClick={() => onAcknowledge(insight)}
                >
                  {t('analytics.acknowledge')}
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
