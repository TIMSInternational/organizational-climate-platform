import { useTranslation } from '../../i18n'
import { KpiTile } from '../charts'
import { Alert, AlertDescription, Progress } from '../ui'
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
 *
 * ## Why these readings are tiles and not a description list
 *
 * They were `<dt>`/`<dd>` pairs set in the sans face at `text-2xl`, which made this the
 * one screen in the redesign whose numbers did not read as instrument readings. A KPI
 * strip of `KpiTile`s is the shape every other page uses between its header and its work,
 * and it brings the typographic law with it: the value is mono with tabular figures, so
 * a count that ticks up does not shift its own width.
 *
 * ## The guarantee sentence is the server's to write
 *
 * `anonymity.guarantee` is authored by the API — it is the sentence that states, for this
 * survey, how far tracking goes. It was never rendered anywhere in this client. It is now
 * the participation section's closing line.
 *
 * It does not replace the catalogue's `anonymousAggregateNote`, and the two are not
 * alternatives: the guarantee says how far tracking goes for this survey, the note says
 * what the responded tile is therefore counting. A suppressed survey needs both, so it
 * renders both — the note as the alert that accounts for the tile, the guarantee as the
 * closing line. The note is never shown for a fully-tracked survey, where it would state
 * the opposite of the truth.
 */
export interface DistributionProgressProps {
  summary: SurveyInvitationSummary
  anonymity: SurveyAnonymityGuarantee
  /** `surveys.response_count` — an aggregate over the whole survey, attributable to nobody. */
  responseCount: number
  /**
   * Reminders dispatched across every invitation on this survey.
   *
   * Summed from the invitation list rather than read off `summary`, which has no such
   * field. `null` when the list has not arrived, because a strip that prints `0` would
   * assert that none were sent.
   */
  remindersSent: number | null
  /** BCP-47 locale for number formatting. */
  locale?: string
}

export default function DistributionProgress({
  summary,
  anonymity,
  responseCount,
  remindersSent,
  locale,
}: DistributionProgressProps) {
  const { t } = useTranslation()
  const completionSuppressed = anonymity.suppressedStates.includes('completed')

  // Outstanding: out and not yet resolved. `pending` is deliberately excluded — a pending
  // invitation has had no notification queued for it, so nobody is waiting on the
  // respondent yet. Same set the reminder route acts on.
  const outstanding = summary.sent + summary.opened + summary.started
  const responded = completionSuppressed ? responseCount : summary.completed
  const percent = summary.total > 0 ? Math.round((responded / summary.total) * 100) : 0

  const guarantee = anonymity.guarantee.trim()

  return (
    <>
      <div className="grid gap-panel-gap sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label={t('surveys.distribution.invited')}
          value={summary.total}
          locale={locale}
        />
        <KpiTile
          label={
            completionSuppressed
              ? t('surveys.distribution.responsesReceived')
              : t('surveys.distribution.responded')
          }
          value={responded}
          locale={locale}
        />
        <KpiTile
          label={t('surveys.distribution.outstanding')}
          value={outstanding}
          locale={locale}
        />
        <KpiTile
          label={t('surveys.distribution.remindersSent')}
          value={remindersSent}
          locale={locale}
        />
      </div>

      <Progress value={percent} aria-label={t('surveys.distribution.progressLabel')} />

      {completionSuppressed && (
        // Not a warning: nothing is wrong. It explains why the middle number is an
        // aggregate, which is the difference between a considered design and a bug.
        //
        // This is a DIFFERENT fact from the guarantee sentence below, which is why both
        // render. The guarantee says how far tracking goes ("stops at opened"); this
        // says what the responded tile therefore counts. Collapsing them into whichever
        // string happens to exist leaves the reader with a number and no account of it.
        <Alert variant="default">
          <AlertDescription>{t('surveys.distribution.anonymousAggregateNote')}</AlertDescription>
        </Alert>
      )}

      {guarantee.length > 0 && (
        // The server's own sentence, rendered verbatim. Deliberately NOT given the
        // catalogue's anonymity note as a fallback: that string is only true of a
        // suppressed survey, and printing it under a fully-tracked one would state the
        // opposite of the truth. A survey whose payload carries no guarantee simply has
        // no sentence to show.
        <p className="text-sm text-fg-secondary">{guarantee}</p>
      )}
    </>
  )
}
