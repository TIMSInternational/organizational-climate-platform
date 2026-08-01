import { useEffect, useState } from 'react'
import { listMicroclimates, createMicroclimate, type Microclimate } from '../api/microclimates'
import MicroclimateList from '../components/MicroclimateList'
import MicroclimateFilters, { type MicroclimateFiltersValue } from '../components/MicroclimateFilters'
import MicroclimateForm, { type MicroclimateFormValues } from '../components/MicroclimateForm'
import { getToken } from '../../../auth/token'
import { decodeJwtPayload } from '../../../auth/jwt'

// Company context comes from the signed-in user's own JWT claim -- the same source
// AdminLayout.tsx/navSections.ts use to decide what nav to show this user (see
// navSections.ts:16-17: nav must never point somewhere the backend would 403 for that
// role). A single hardcoded company id would violate that same invariant: any
// company_admin whose company differs from a hardcoded value would get Results.Forbid()
// from MicroclimateEndpoints.ListAsync's CanAccessCompany check.
export default function MicroclimatesListPage() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
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
    if (!companyId) return
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
    return <p role="alert">Unable to determine your company. Please log in again.</p>
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
