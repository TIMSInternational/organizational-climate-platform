import { useTranslation } from '../../i18n'
import { Alert, AlertDescription, Card, CardContent, Progress, SectionLabel } from '../ui'
import type {
  SurveyAnonymityGuarantee,
  SurveyInvitationSummary,
} from '../../features/surveys/api/surveyDistribution'

/**
 * Who was invited, who has responded, and what is outstanding.
 *
 * This is what makes a distribution page worth having over a fire-and-forget button, and
 * it is also where the anonymity boundary is easiest to get wrong.
 *
 * ## The anonymous case is not "the same numbers, smaller"
 *
 * For an anonymous survey the API records nothing past `opened` — `started_at` and
 * `completed_at` are never written against an individual, because each is a per-person
 * timestamp taken within moments of `responses.start_time`, and an admin holding both
 * tables joins them on time and re-identifies the respondent.
 *
 * So `summary.completed` is a structural **zero**, not a measurement. Rendering "0 of 12
 * completed" from it would be a lie with a progress bar attached. When the API says the
 * state is suppressed, this component shows the aggregate response count instead — the
 * only shape of that number that names nobody — and says why in plain words rather than
 * leaving an unexplained gap.
 *
 * The suppression is read off `anonymity.suppressedStates` rather than recomputed from
 * `anonymity.anonymous`, so the ceiling lives in exactly one place (the server's
 * `SurveyInvitationStatuses.AnonymityCeiling`) instead of two that can drift.
 */
export interface DistributionProgressProps {
  summary: SurveyInvitationSummary
  anonymity: SurveyAnonymityGuarantee
  /** `surveys.response_count` — an aggregate over the whole survey, attributable to nobody. */
  responseCount: number
}

export default function DistributionProgress({
  summary,
  anonymity,
  responseCount,
}: DistributionProgressProps) {
  const { t } = useTranslation()
  const completionSuppressed = anonymity.suppressedStates.includes('completed')

  // Outstanding: out and not yet resolved. `pending` is deliberately excluded — a pending
  // invitation has had no notification queued for it, so nobody is waiting on the
  // respondent yet. Same set the reminder route acts on.
  const outstanding = summary.sent + summary.opened + summary.started
  const responded = completionSuppressed ? responseCount : summary.completed
  const percent = summary.total > 0 ? Math.round((responded / summary.total) * 100) : 0

  return (
    <Card>
      <CardContent className="flex flex-col gap-panel-gap">
        <SectionLabel>{t('surveys.distribution.progressTitle')}</SectionLabel>

        <dl className="grid grid-cols-1 gap-panel-gap sm:grid-cols-3">
          <div>
            <dt className="text-sm text-fg-secondary">{t('surveys.distribution.invited')}</dt>
            <dd className="text-2xl font-semibold text-fg-primary">{summary.total}</dd>
          </div>
          <div>
            <dt className="text-sm text-fg-secondary">
              {completionSuppressed
                ? t('surveys.distribution.responsesReceived')
                : t('surveys.distribution.responded')}
            </dt>
            <dd className="text-2xl font-semibold text-fg-primary">{responded}</dd>
          </div>
          <div>
            <dt className="text-sm text-fg-secondary">{t('surveys.distribution.outstanding')}</dt>
            <dd className="text-2xl font-semibold text-fg-primary">{outstanding}</dd>
          </div>
        </dl>

        <Progress
          value={percent}
          aria-label={t('surveys.distribution.progressLabel')}
        />

        {completionSuppressed && (
          // Not a warning: nothing is wrong. It explains why the middle number is an
          // aggregate, which is the difference between a considered design and a bug.
          <Alert variant="default">
            <AlertDescription>{t('surveys.distribution.anonymousAggregateNote')}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
