import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader } from '../ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Progress } from '../ui/progress'
import { formatMetric, type MetricFormat } from './formatMetric'

export type RecommendationKind = 'insight' | 'action' | 'alert' | 'prediction'
export type RecommendationPriority = 'low' | 'medium' | 'high' | 'critical'
export type EffortImpact = 'low' | 'medium' | 'high'

export interface RecommendedAction {
  id: string
  /** Already-translated. */
  title: string
  /** Already-translated. */
  description: string
  effort: EffortImpact
  impact: EffortImpact
  /** Already-formatted timeframe, e.g. "2 weeks". */
  timeline: string
  assignee?: string
}

interface RecommendationCardProps {
  /** Already-translated. */
  title: string
  /** Already-translated. */
  description: string
  kind: RecommendationKind
  priority: RecommendationPriority
  /**
   * How sure the model is, as a fraction 0–1.
   *
   * Values outside that range are clamped and reported as such rather than
   * rendered: legacy did `Math.round(confidence * 100)` unguarded, so a caller
   * passing 42 (meaning 42%) displayed "4200%".
   */
  confidence: number
  /** Already-translated category name. */
  category: string
  /** Already-translated area names. */
  affectedAreas?: readonly string[]
  actions?: readonly RecommendedAction[]
  metrics?: { current: number; target: number; format?: MetricFormat }
  /**
   * Whether this has been accepted.
   *
   * Controlled by the caller, not tracked internally. Legacy set its own
   * `isAccepted` state the instant the button was clicked and then called
   * `onAccept`, so if the parent's mutation failed the card sat there claiming
   * "Accepted" for something the server had rejected. Acceptance is a fact about
   * the server, so it belongs to whoever talks to it.
   */
  isAccepted?: boolean
  onAccept?: () => void
  onDismiss?: () => void
  onViewDetails?: () => void
  /** BCP-47 locale. Defaults to the document's language. */
  locale?: string
}

/**
 * One AI recommendation, with what it is based on and what to do about it.
 *
 * Replaces legacy `RecommendationCard`. Not a chart — it is the card the analytics
 * pages put *next* to the charts — but it ships with them because it is the
 * eleventh component #79 lists.
 *
 * ## Colour changes from the legacy version
 *
 * Legacy tinted the whole card by kind (`bg-blue-50`, `bg-green-50`, `bg-red-50`,
 * `bg-purple-50`) plus a matching left border, so a page of recommendations was a
 * page of coloured blocks competing with the actual charts. Here the kind shows in
 * a left border and a badge only, and the card keeps the standard surface.
 *
 * Legacy also mapped `priority` onto badge variants such that **`high` and
 * `critical` were both `destructive`** — the two most important levels rendered
 * identically, which is precisely where the distinction matters. They are now
 * distinguishable: critical is the solid destructive fill, high is the amber
 * warning.
 *
 * The confidence figure lost its `Star` icon. A star means rating or quality;
 * confidence is neither, and a five-star metaphor invites the reader to treat 60%
 * confidence as a mediocre *recommendation* rather than as an uncertain one.
 */
export default function RecommendationCard({
  title,
  description,
  kind,
  priority,
  confidence,
  category,
  affectedAreas = [],
  actions = [],
  metrics,
  isAccepted = false,
  onAccept,
  onDismiss,
  onViewDetails,
  locale,
}: RecommendationCardProps) {
  const { t } = useTranslation()
  const [actionsOpen, setActionsOpen] = useState(false)

  const kindBorder =
    kind === 'alert'
      ? 'border-l-accent-red'
      : kind === 'action'
        ? 'border-l-accent-green'
        : kind === 'prediction'
          ? 'border-l-accent-purple'
          : 'border-l-accent-blue'

  const kindLabel =
    kind === 'alert'
      ? t('charts.recommendationAlert')
      : kind === 'action'
        ? t('charts.recommendationAction')
        : kind === 'prediction'
          ? t('charts.recommendationPrediction')
          : t('charts.recommendationInsight')

  const priorityLabel =
    priority === 'critical'
      ? t('charts.priorityCritical')
      : priority === 'high'
        ? t('charts.priorityHigh')
        : priority === 'medium'
          ? t('charts.priorityMedium')
          : t('charts.priorityLow')

  const priorityVariant =
    priority === 'critical'
      ? 'destructive'
      : priority === 'high'
        ? 'warning'
        : priority === 'medium'
          ? 'default'
          : 'secondary'

  const clampedConfidence = Math.max(0, Math.min(1, Number.isFinite(confidence) ? confidence : 0))

  return (
    <Card className={`border-l-4 ${kindBorder}`}>
      <CardHeader className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{kindLabel}</Badge>
          <Badge variant={priorityVariant}>{priorityLabel}</Badge>
          <Badge variant="secondary">{category}</Badge>
        </div>
        <h3 className="m-0">{title}</h3>
        <Confidence value={clampedConfidence} locale={locale} />
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <p className="m-0 text-fg-secondary">{description}</p>

        {metrics ? <Metrics metrics={metrics} locale={locale} /> : null}

        {affectedAreas.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h4 className="m-0 text-sm font-medium">{t('charts.affectedAreas')}</h4>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {affectedAreas.map((area) => (
                <li key={area} className="m-0">
                  <Badge variant="outline">{area}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {actions.length > 0 ? (
          // Radix Collapsible rather than a hand-rolled toggle: it wires
          // aria-expanded and aria-controls between trigger and panel, which the
          // legacy `<button onClick={setIsExpanded}>` did not, so a screen reader
          // could not tell the section was collapsed.
          <Collapsible open={actionsOpen} onOpenChange={setActionsOpen}>
            <CollapsibleTrigger className="text-sm font-medium">
              {t('charts.recommendedActions', { count: String(actions.length) })}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {actions.map((action) => (
                  <li key={action.id} className="m-0">
                    <ActionDetail action={action} />
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {isAccepted ? (
            <p role="status" className="m-0 text-sm font-medium text-accent-green">
              {t('charts.recommendationAccepted')}
            </p>
          ) : (
            <>
              {onAccept ? (
                <Button onClick={onAccept} size="sm">
                  {t('charts.acceptRecommendation')}
                </Button>
              ) : null}
              {onDismiss ? (
                <Button onClick={onDismiss} variant="ghost" size="sm">
                  {t('charts.dismissRecommendation')}
                </Button>
              ) : null}
            </>
          )}
          {onViewDetails ? (
            <Button onClick={onViewDetails} variant="outline" size="sm">
              {t('charts.viewDetails')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Model confidence, as a labelled figure and a meter.
 *
 * The label is spelled out because a bare "72%" on a recommendation card is
 * ambiguous — a reader can just as easily take it for the size of the effect as
 * for how sure the model is.
 */
function Confidence({ value, locale }: { value: number; locale?: string }) {
  const { t } = useTranslation()
  const percentage = value * 100

  return (
    <div className="flex items-center gap-2 text-xs text-fg-tertiary">
      <span>{t('charts.confidence')}</span>
      <span className="font-medium text-fg-secondary">
        {formatMetric(percentage, { kind: 'percentage', decimals: 0 }, locale)}
      </span>
      <Progress
        value={Math.round(percentage)}
        className="max-w-24"
        aria-label={t('charts.confidenceMeter')}
      />
    </div>
  )
}

/** Where the metric stands against where the recommendation would take it. */
function Metrics({
  metrics,
  locale,
}: {
  metrics: { current: number; target: number; format?: MetricFormat }
  locale?: string
}) {
  const { t } = useTranslation()
  const format = metrics.format ?? { kind: 'number' }
  const render = (value: number) => formatMetric(value, format, locale)

  // Legacy computed `(current / target) * 100` with no guard, so a target of 0
  // rendered a bar of width `Infinity%`.
  const attained =
    metrics.target === 0 ? (metrics.current <= 0 ? 100 : 0) : (metrics.current / metrics.target) * 100

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line-light p-4">
      <dl className="m-0 flex items-center justify-between text-sm">
        <div className="flex flex-col">
          <dt className="text-xs text-fg-tertiary">{t('charts.currentValue')}</dt>
          <dd className="m-0 font-semibold">{render(metrics.current)}</dd>
        </div>
        <div className="flex flex-col text-right">
          <dt className="text-xs text-fg-tertiary">{t('charts.targetValue')}</dt>
          <dd className="m-0 font-semibold">{render(metrics.target)}</dd>
        </div>
      </dl>
      <Progress
        // Rounded before it reaches `aria-valuenow` -- see KPIDisplay.
        value={Math.round(Math.max(0, Math.min(100, attained)))}
        aria-label={t('charts.progressToTarget', {
          value: render(metrics.current),
          target: render(metrics.target),
        })}
      />
    </div>
  )
}

/**
 * One recommended action.
 *
 * Effort and impact are shown as plain labelled text rather than legacy's
 * traffic-light chips. There, `effort: 'low'` was green and `effort: 'high'` red
 * — the same colours as `impact`, where the polarity is *inverted*: high impact is
 * good news and high effort is bad. A reader scanning for green therefore had to
 * remember which column reversed the meaning, which is exactly the ambiguity
 * reserving green/amber/red for status is meant to prevent.
 */
function ActionDetail({ action }: { action: RecommendedAction }) {
  const { t } = useTranslation()

  const level = (value: EffortImpact) =>
    value === 'high'
      ? t('charts.levelHigh')
      : value === 'medium'
        ? t('charts.levelMedium')
        : t('charts.levelLow')

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line-light p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 className="m-0">{action.title}</h5>
        <span className="text-xs text-fg-tertiary">
          {t('charts.timeline', { value: action.timeline })}
        </span>
      </div>
      <p className="m-0 text-sm text-fg-secondary">{action.description}</p>
      <dl className="m-0 flex flex-wrap gap-4 text-xs text-fg-tertiary">
        <div className="flex gap-2">
          <dt>{t('charts.effort')}</dt>
          <dd className="m-0 font-medium text-fg-secondary">{level(action.effort)}</dd>
        </div>
        <div className="flex gap-2">
          <dt>{t('charts.impact')}</dt>
          <dd className="m-0 font-medium text-fg-secondary">{level(action.impact)}</dd>
        </div>
        {action.assignee ? (
          <div className="flex gap-2">
            <dt>{t('charts.assignee')}</dt>
            <dd className="m-0 font-medium text-fg-secondary">{action.assignee}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}
