import type { AIInsightListItem } from '../api/insights'
import { useTranslation } from '../../../i18n'
import { Badge, Table } from '../../../components/ui'

export interface InsightListProps {
  insights: AIInsightListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * The insight table.
 *
 * Rows open a detail rather than expanding in place, because the fields that
 * matter — description, recommended actions, and the acknowledgement attribution
 * — are only on `AIInsightDetail`; `AIInsightListItem` carries seven fields and
 * none of them is the acknowledger.
 *
 * `priority` and `type` are rendered as the API's own strings rather than mapped
 * to a translated vocabulary. The values are produced by generation (#92), which
 * does not exist, so any mapping written now would be a guess at a vocabulary
 * that has not been chosen — and a `t()` miss renders the raw key path, which is
 * worse than rendering the raw value.
 */
export default function InsightList({ insights, selectedId, onSelect }: InsightListProps) {
  const { t } = useTranslation()

  return (
    <Table>
      <thead>
        <tr>
          <th>{t('common.label')}</th>
          <th>{t('common.type')}</th>
          <th>{t('insights.priority')}</th>
          <th>{t('common.status')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {insights.map((insight) => (
          <tr key={insight.id} data-state={insight.id === selectedId ? 'selected' : undefined}>
            <td>{insight.title}</td>
            <td>{insight.type}</td>
            <td>{insight.priority}</td>
            <td>
              <Badge variant={insight.isAcknowledged ? 'secondary' : 'warning'}>
                {insight.isAcknowledged ? t('insights.acknowledged') : t('insights.open')}
              </Badge>
            </td>
            <td>
              <button onClick={() => onSelect(insight.id)}>{t('common.viewDetails')}</button>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
