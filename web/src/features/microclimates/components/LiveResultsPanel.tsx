import { useEffect, useState } from 'react'
import { getLiveResults, type LiveResults } from '../api/microclimates'
import { useTranslation } from '../../../i18n'

interface LiveResultsPanelProps {
  baseUrl: string
  microclimateId: string
  isActive: boolean
}

export default function LiveResultsPanel({ baseUrl, microclimateId, isActive }: LiveResultsPanelProps) {
  const { t } = useTranslation()
  const [live, setLive] = useState<LiveResults | null>(null)

  useEffect(() => {
    if (!isActive) return

    let cancelled = false

    async function poll() {
      try {
        const result = await getLiveResults(baseUrl, microclimateId)
        if (!cancelled) setLive(result)
      } catch {
        // Transient poll failures are not surfaced as page-level errors -- the
        // next successful poll recovers the view silently.
      }
    }

    poll()
    const interval = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [baseUrl, microclimateId, isActive])

  if (!isActive) {
    return <p>{t('microclimates.liveResultsOnlyWhenActive')}</p>
  }

  if (!live) {
    return <p>{t('microclimates.loadingLiveResults')}</p>
  }

  return (
    <div>
      <p>
        {t('microclimates.responsesLabel')} {live.responseCount} / {live.targetParticipantCount}
      </p>
      <p>
        {t('microclimates.engagementLabel')} {live.engagementLevel}
      </p>
      <ul>
        {live.wordCloud.map((entry) => (
          <li key={entry.text}>{entry.text} ({entry.value})</li>
        ))}
      </ul>
    </div>
  )
}
