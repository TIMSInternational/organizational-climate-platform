import type { AIInsight } from '../api/insights'
import { useTranslation } from '../../../i18n'
import { Badge } from '../../../components/ui'
import { formatMetric } from '../../../components/charts'

export interface InsightDetailPanelProps {
  insight: AIInsight
  /**
   * The acknowledger's display name, resolved by the page, or `null` when it
   * could not be.
   *
   * `AIInsight.acknowledgedBy` is a user id. Rendering a bare GUID satisfies
   * "attribution" on paper and tells a reader nothing, so the page resolves it —
   * and `null` here means the lookup failed (a cross-tenant acknowledger a
   * CompanyAdmin may not read, most plausibly), which is why this falls back to
   * wording rather than to printing the id.
   */
  acknowledgedByName: string | null
  acknowledging: boolean
  onAcknowledge: () => void
}

/**
 * One insight in full, with the acknowledgement stated rather than implied.
 *
 * The acknowledgement line is the reason this panel exists: `isAcknowledged` is a
 * boolean on the list row, and a boolean cannot answer "who dismissed this, and
 * when" — which is the question an admin asks when an insight they care about has
 * quietly gone away.
 */
export default function InsightDetailPanel({
  insight,
  acknowledgedByName,
  acknowledging,
  onAcknowledge,
}: InsightDetailPanelProps) {
  const { t, locale } = useTranslation()

  function acknowledgementLine(): string {
    // An acknowledged insight with no `acknowledgedAt` should not happen -- the
    // API sets both together -- but saying so plainly beats rendering
    // "Acknowledged by ... on Invalid Date", which is what a blind `new Date()`
    // would produce.
    if (!insight.acknowledgedAt) return t('insights.acknowledgedUnattributed')
    const when = new Date(insight.acknowledgedAt)
    if (Number.isNaN(when.getTime())) return t('insights.acknowledgedUnattributed')
    return t('insights.acknowledgedByOn', {
      who: acknowledgedByName ?? t('insights.unknownUser'),
      when: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(when),
    })
  }

  return (
    <section>
      <h2>{insight.title}</h2>
      <p>
        <Badge variant={insight.isAcknowledged ? 'secondary' : 'warning'}>
          {insight.isAcknowledged ? t('insights.acknowledged') : t('insights.open')}
        </Badge>
      </p>
      <p>{insight.description}</p>
      <dl>
        <dt>{t('common.type')}</dt>
        <dd>{insight.type}</dd>
        <dt>{t('insights.priority')}</dt>
        <dd>{insight.priority}</dd>
        <dt>{t('insights.confidence')}</dt>
        {/* `confidenceScore` is an integer 0-100 on the entity, so it is a
            percentage already -- passing it to `formatMetric`'s percentage kind
            would divide by 100 and read 0 %. */}
        <dd>
          {t('insights.confidenceValue', {
            score: formatMetric(insight.confidenceScore, { kind: 'number' }, locale),
          })}
        </dd>
      </dl>

      {insight.affectedSegments.length > 0 && (
        <>
          <h3>{t('insights.affectedSegments')}</h3>
          <ul>
            {insight.affectedSegments.map((segment) => (
              <li key={segment}>{segment}</li>
            ))}
          </ul>
        </>
      )}

      {insight.recommendedActions.length > 0 && (
        <>
          <h3>{t('insights.recommendedActions')}</h3>
          <ul>
            {insight.recommendedActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </>
      )}

      {insight.isAcknowledged ? (
        <p>{acknowledgementLine()}</p>
      ) : (
        <button onClick={onAcknowledge} disabled={acknowledging}>
          {acknowledging ? t('insights.acknowledging') : t('insights.acknowledge')}
        </button>
      )}
    </section>
  )
}
