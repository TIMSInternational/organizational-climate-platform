import { Check } from 'lucide-react'
import type { AIInsight } from '../api/insights'
import { useTranslation } from '../../../i18n'
import { Badge, Button } from '../../../components/ui'
import { formatMetric } from '../../../components/charts'
import { insightPriorityLabel, insightTypeLabel } from '../insightVocabulary'

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
 * One insight in full: what it found, how sure the model is, and what to do.
 *
 * ## Order, and why it is this one
 *
 * Title → chips → evidence → recommended actions → the verb. That is the order the
 * reader needs them in: an action offered before the evidence is a suggestion with
 * nothing behind it, which is exactly the objection an admin has to a machine
 * telling them what to do. Each action carries a tick glyph rather than a bullet,
 * so the block reads as a checklist to work through rather than as more prose.
 *
 * ## Confidence is a reading, so it is set as one
 *
 * `confidenceScore` is an integer 0-100 on the entity, so it is already a
 * percentage — handing it to `formatMetric`'s percentage kind would divide by 100
 * and print 0 %. It sits in a chip beside the priority and type, in mono with
 * tabular figures, because it is a measurement and everything measured on this
 * product is set in mono. The label is beside it: a bare "82" is not a confidence.
 *
 * ## The acknowledgement line is the reason this panel exists
 *
 * `isAcknowledged` is a boolean on the list row, and a boolean cannot answer "who
 * dismissed this, and when" — which is the question an admin asks when an insight
 * they care about has quietly gone away. Once acknowledged, the verb is replaced by
 * that sentence rather than sitting beside it: there is no un-acknowledge verb on
 * the API, so a button there could only be inert.
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
    <section className="rounded-lg border border-line-light bg-surface-icon-box p-panel">
      <p className="mb-0 text-2xs font-bold uppercase tracking-eyebrow text-fg-label">
        {t('insights.selectedInsight')}
      </p>
      <h2 className="mt-1 mb-inline text-xl">{insight.title}</h2>

      <div className="flex flex-wrap items-center gap-1">
        {/* Same vocabulary the list uses (#282) — the two surfaces show the same
            two fields for the same row, so a value that reads "Riesgo" in the
            list must not read "risk" one click later. */}
        <Badge variant="outline">{insightPriorityLabel(t, insight.priority)}</Badge>
        <Badge variant="secondary">{insightTypeLabel(t, insight.type)}</Badge>
        <Badge variant="secondary">
          {insight.isAcknowledged ? t('insights.acknowledged') : t('insights.open')}
        </Badge>
        <Badge variant="secondary">
          {t('insights.confidence')}{' '}
          <span className="font-mono tabular-nums">
            {t('insights.confidenceValue', {
              score: formatMetric(insight.confidenceScore, { kind: 'number' }, locale),
            })}
          </span>
        </Badge>
      </div>

      <p className="mt-inline mb-0 max-w-prose text-base text-fg-secondary">
        {insight.description}
      </p>

      {insight.affectedSegments.length > 0 && (
        <div className="mt-section">
          <h3 className="mb-inline text-base">{t('insights.affectedSegments')}</h3>
          <div className="flex flex-wrap gap-1">
            {insight.affectedSegments.map((segment) => (
              <Badge key={segment} variant="secondary">
                {segment}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {insight.recommendedActions.length > 0 && (
        <div className="mt-section">
          <h3 className="mb-inline text-base">{t('insights.recommendedActions')}</h3>
          <ul className="m-0 flex list-none flex-col gap-inline p-0">
            {insight.recommendedActions.map((action) => (
              <li key={action} className="mb-0 flex items-start gap-inline text-base text-fg-secondary">
                <Check aria-hidden="true" className="mt-px size-icon shrink-0 text-fg-primary" />
                <span className="min-w-0">{action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-section">
        {insight.isAcknowledged ? (
          <p className="mb-0 text-sm text-fg-tertiary">{acknowledgementLine()}</p>
        ) : (
          <Button variant="primary" onClick={onAcknowledge} disabled={acknowledging}>
            {acknowledging ? t('insights.acknowledging') : t('insights.acknowledge')}
          </Button>
        )}
      </div>
    </section>
  )
}
