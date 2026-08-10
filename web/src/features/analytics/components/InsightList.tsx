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
 * been chosen", and that much is still true — `AIInsightValidation` bounds both to
 * 20 characters and checks nothing else, so there is no enum anywhere to transcribe.
 * What that objection got wrong was the remedy, not the diagnosis: the catalogue is
 * a best-effort list of the values this repository actually attests, and the helper
 * falls back to the server's own string for anything it does not recognise. An
 * unlabelled value therefore renders as itself rather than as a raw key path.
 * `insightVocabulary.ts` documents where each entry comes from.
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
