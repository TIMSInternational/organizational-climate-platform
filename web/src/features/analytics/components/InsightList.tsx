import type { AIInsightListItem } from '../api/insights'
import { useTranslation } from '../../../i18n'
import { Badge, Table } from '../../../components/ui'
import { insightPriorityLabel, insightTypeLabel } from '../insightVocabulary'

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
 * `priority` and `type` go through `insightVocabulary.ts` (#282). They used to be
 * printed as the API's own strings on the grounds that #92's vocabulary "has not
 * been chosen" — but it has: the legacy `AIInsightSchema` declares both as closed
 * enums, so the catalogue is transcribed rather than guessed. The half of that
 * objection which still stands is the `t()` miss, and the helper answers it by
 * falling back to the raw value for anything it does not recognise.
 *
 * The first column is headed as the *title*, not "Label". `AIInsightListItem`
 * calls the field `title`, and `common.label` is the generic word for a form
 * field's caption — the same shape of mismatch the survey wizard's "Surveys"
 * heading was.
 */
export default function InsightList({ insights, selectedId, onSelect }: InsightListProps) {
  const { t } = useTranslation()

  return (
    <Table>
      <thead>
        <tr>
          <th>{t('insights.insightTitle')}</th>
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
            <td>{insightTypeLabel(t, insight.type)}</td>
            <td>{insightPriorityLabel(t, insight.priority)}</td>
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
