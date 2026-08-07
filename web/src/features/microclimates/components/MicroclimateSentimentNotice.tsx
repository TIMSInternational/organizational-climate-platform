import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, AlertTitle } from '../../../components/ui'

/**
 * Why there is no sentiment chart on a page that has a `sentimentScore` to draw one
 * from.
 *
 * `MicroclimateEndpoints.SubmitResponseAsync` assigns
 * `microclimate.LiveResults.SentimentScore = 0` on every single submission — it is a
 * placeholder pending #67, not a measurement. So the field is always exactly `0`, and
 * every possible rendering of it is a lie: a gauge at neutral says the workforce is
 * neutral, a "0.0" says it was scored, and a badge saying "estimated" still puts a
 * number on screen that a reader will quote in a meeting.
 *
 * `SentimentVisualization` and `sentimentStub` therefore stay out of every
 * customer-reachable microclimate page. `sentimentStub` is deliberately not exported
 * from the chart barrel for exactly this reason — its own comment says a barrel
 * export is how a stub ends up in a real page without anyone noticing.
 *
 * Saying the capability is not enabled yet is more useful than any of those, and it
 * is the one statement that stays true until #67 lands.
 */
export default function MicroclimateSentimentNotice() {
  const { t } = useTranslation()

  return (
    <Alert role="status">
      <AlertTitle>{t('microclimates.sentimentUnavailableTitle')}</AlertTitle>
      <AlertDescription>{t('microclimates.sentimentUnavailableDescription')}</AlertDescription>
    </Alert>
  )
}
