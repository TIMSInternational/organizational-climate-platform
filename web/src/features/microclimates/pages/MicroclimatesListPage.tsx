import { useEffect, useState } from 'react'
import { listMicroclimates, createMicroclimate, type Microclimate } from '../api/microclimates'
import MicroclimateList from '../components/MicroclimateList'
import MicroclimateFilters, { type MicroclimateFiltersValue } from '../components/MicroclimateFilters'
import MicroclimateForm, { type MicroclimateFormValues } from '../components/MicroclimateForm'

// Same stopgap as ActionPlansListPage (Task 5 of #53's plan) -- no company-context
// selector exists yet in the admin shell. See that plan's note; #57 (cross-cutting
// frontend) or a later pass should replace this with a real selector.
export default function MicroclimatesListPage() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const companyId = import.meta.env.VITE_DEFAULT_COMPANY_ID as string
  const [microclimates, setMicroclimates] = useState<Microclimate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<MicroclimateFiltersValue>({ status: '' })
  const [showCreateForm, setShowCreateForm] = useState(false)

  async function reload() {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const result = await listMicroclimates(baseUrl, companyId)
      setMicroclimates(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load microclimates')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const filtered = microclimates.filter((m) => !filters.status || m.status === filters.status)

  async function handleCreate(values: MicroclimateFormValues) {
    await createMicroclimate(baseUrl, {
      title: values.title,
      companyId,
      startTime: values.startTime,
      endTime: values.endTime,
      targetParticipantCount: values.targetParticipantCount,
      anonymousResponses: values.anonymousResponses,
      questions: values.questions,
    })
    setShowCreateForm(false)
    await reload()
  }

  if (!companyId) {
    return <p role="alert">VITE_DEFAULT_COMPANY_ID is not configured.</p>
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <h1>Microclimates</h1>
      <MicroclimateFilters value={filters} onChange={setFilters} />
      <button onClick={() => setShowCreateForm((v) => !v)}>{showCreateForm ? 'Cancel' : 'New microclimate'}</button>
      {showCreateForm && <MicroclimateForm onSubmit={handleCreate} />}
      {loading ? <p>Loading…</p> : <MicroclimateList microclimates={filtered} />}
    </div>
  )
}
