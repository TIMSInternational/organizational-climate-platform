import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getMicroclimate, updateMicroclimate, type MicroclimateDetail } from '../api/microclimates'
import LiveResultsPanel from '../components/LiveResultsPanel'

const STATUSES = ['draft', 'active', 'closed']

export default function MicroclimateDetailPage() {
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [microclimate, setMicroclimate] = useState<MicroclimateDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    if (!id) return
    setError(null)
    try {
      const result = await getMicroclimate(baseUrl, id)
      setMicroclimate(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load microclimate')
    }
  }

  useEffect(() => {
    reload()
  }, [id])

  async function handleStatusChange(status: string) {
    if (!id) return
    setError(null)
    try {
      await updateMicroclimate(baseUrl, id, { status })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!microclimate) {
    return <p>Loading…</p>
  }

  return (
    <div>
      <h1>{microclimate.title}</h1>
      <label>
        Status
        <select value={microclimate.status} onChange={(e) => handleStatusChange(e.target.value)}>
          {STATUSES.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </label>

      <h2>Live results</h2>
      <LiveResultsPanel baseUrl={baseUrl} microclimateId={microclimate.id} isActive={microclimate.status === 'active'} />
    </div>
  )
}
