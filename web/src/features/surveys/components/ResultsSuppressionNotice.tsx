import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui'

interface ResultsSuppressionNoticeProps {
  /** `SurveyResultsPrivacy`'s machine-readable reason code, e.g. `below_minimum_respondents`. */
  reason: string | null
  /** The floor that was not met. */
  minimumGroupSize: number
}

/**
 * Why there are no per-question results on a page whose whole purpose is per-question
 * results.
 *
 * The server returns `isSuppressed: true` with empty `questions` and `breakdowns` and a
 * populated `summary`. Rendering that as an empty section would read as "nobody answered
 * anything" beside participation counters saying four people did — a contradiction the
 * reader would resolve as a bug, and then work around by asking someone for the raw data.
 * Saying *why* is what stops that.
 *
 * The reason arrives as a code, not as prose: the API deliberately does not ship display
 * copy, so the mapping to a sentence lives here and gets translated like everything else.
 * An unrecognised code falls back to a generic sentence rather than to the raw code —
 * unlike a data value such as a status or a department name, a reason code is not
 * something a reader can act on, so showing it would be noise rather than honesty.
 */
export default function ResultsSuppressionNotice({
  reason,
  minimumGroupSize,
}: ResultsSuppressionNoticeProps) {
  const { t } = useTranslation()

  const explanation =
    reason === 'below_minimum_respondents'
      ? t('surveyResults.suppressedBelowMinimum', { minimum: minimumGroupSize })
      : t('surveyResults.suppressedGeneric')

  return (
    <Alert variant="warning">
      <AlertTitle>{t('surveyResults.suppressedTitle')}</AlertTitle>
      <AlertDescription>
        <span className="grid gap-1">
          <span>{explanation}</span>
          <span>{t('surveyResults.suppressedParticipationStillShown')}</span>
        </span>
      </AlertDescription>
    </Alert>
  )
}
