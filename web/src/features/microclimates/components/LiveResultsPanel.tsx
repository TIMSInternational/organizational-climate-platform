import { useEffect, useState } from 'react'
import { getLiveResults, type LiveResults } from '../api/microclimates'

interface LiveResultsPanelProps {
  baseUrl: string
  microclimateId: string
  isActive: boolean
}

export default function LiveResultsPanel({ baseUrl, microclimateId, isActive }: LiveResultsPanelProps) {
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
    return <p>Live results are only available while this microclimate is active.</p>
  }

  if (!live) {
    return <p>Loading live results…</p>
  }

  return (
    <div>
      <p>Responses: {live.responseCount} / {live.targetParticipantCount}</p>
      <p>Engagement: {live.engagementLevel}</p>
      <ul>
        {live.wordCloud.map((entry) => (
          <li key={entry.text}>{entry.text} ({entry.value})</li>
        ))}
      </ul>
    </div>
  )
}
