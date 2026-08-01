import { useEffect, useState } from 'react'
import { listMicroclimates, createMicroclimate, type Microclimate } from '../api/microclimates'
import { listMicroclimateTemplates, type MicroclimateTemplate } from '../api/microclimateTemplates'
import MicroclimateList from '../components/MicroclimateList'
import MicroclimateFilters, { type MicroclimateFiltersValue } from '../components/MicroclimateFilters'
import MicroclimateForm, { type MicroclimateFormValues } from '../components/MicroclimateForm'
import { getToken } from '../../../auth/token'
import { decodeJwtPayload } from '../../../auth/jwt'

// This slice has no company-picker UI yet (org-structure's admin shell doesn't
// expose a "current company" concept for a SuperAdmin browsing across
// companies). CompanyAdmin's own companyId comes straight off their JWT
// claims -- the same source AdminLayout.tsx already uses for nav/routing --
// so every CompanyAdmin sees and creates microclimates for their own company,
// not a globally-configured one.
//
// SuperAdmin is deliberately NOT routed down the same "use claims.companyId"
// path. Unlike CompanyAdmin, SuperAdmin *does* always carry a companyId claim
// (JwtTokenService emits it unconditionally off the non-nullable User.CompanyId
// column) -- so falling through to that path wouldn't error, it would quietly
// scope a SuperAdmin to whatever single company their own user row happens to
// point at, with no picker and no indication anything was scoped at all,
// including any microclimate they went on to create. Block it explicitly
// instead until #57 (cross-cutting company-context selector) lands.
export default function MicroclimatesListPage() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const token = getToken()
  const claims = token ? decodeJwtPayload(token) : null
  const role = typeof claims?.role === 'string' ? claims.role : undefined
  const companyId = typeof claims?.companyId === 'string' ? claims.companyId : undefined
  const isSuperAdmin = role === 'super_admin'
  const [microclimates, setMicroclimates] = useState<Microclimate[]>([])
  const [templates, setTemplates] = useState<MicroclimateTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<MicroclimateFiltersValue>({ status: '' })
  const [showCreateForm, setShowCreateForm] = useState(false)

  async function reload() {
    if (!companyId || isSuperAdmin) return
    setLoading(true)
    setError(null)
    try {
      const [microclimatesResult, templatesResult] = await Promise.all([
        listMicroclimates(baseUrl, companyId),
        listMicroclimateTemplates(baseUrl, companyId),
      ])
      setMicroclimates(microclimatesResult)
      setTemplates(templatesResult)
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
    if (!companyId || isSuperAdmin) return
    await createMicroclimate(baseUrl, {
      title: values.title,
      companyId,
      startTime: values.startTime,
      endTime: values.endTime,
      targetParticipantCount: values.targetParticipantCount,
      anonymousResponses: values.anonymousResponses,
      templateId: values.templateId,
      questions: values.questions,
    })
    setShowCreateForm(false)
    await reload()
  }

  if (isSuperAdmin) {
    return (
      <p role="alert">
        SuperAdmin company-scoped browsing for Microclimates is not available yet -- see issue #57.
      </p>
    )
  }

  if (!companyId) {
    return <p role="alert">No company is associated with your account.</p>
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <h1>Microclimates</h1>
      <MicroclimateFilters value={filters} onChange={setFilters} />
      <button onClick={() => setShowCreateForm((v) => !v)}>{showCreateForm ? 'Cancel' : 'New microclimate'}</button>
      {showCreateForm && <MicroclimateForm templates={templates} onSubmit={handleCreate} />}
      {loading ? <p>Loading…</p> : <MicroclimateList microclimates={filtered} />}
    </div>
  )
}
