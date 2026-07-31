import { useEffect, useState } from 'react'
import { listCompanies, createCompany, type Company } from '../api/companies'
import CompanyList from '../components/CompanyList'
import CompanyFilters, { type CompanyFiltersValue } from '../components/CompanyFilters'
import CompanyForm, { type CompanyFormValues } from '../components/CompanyForm'

export default function CompaniesListPage() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<CompanyFiltersValue>({ search: '' })
  const [showCreateForm, setShowCreateForm] = useState(false)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const result = await listCompanies(baseUrl)
      setCompanies(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load companies')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const filtered = companies.filter((company) => {
    const search = filters.search.toLowerCase()
    if (!search) return true
    return (
      company.name.toLowerCase().includes(search)
      || (company.emailDomain?.toLowerCase().includes(search) ?? false)
      || (company.industry?.toLowerCase().includes(search) ?? false)
    )
  })

  async function handleCreate(values: CompanyFormValues) {
    await createCompany(baseUrl, {
      name: values.name,
      emailDomain: values.emailDomain,
      industry: values.industry,
      size: values.size,
      country: values.country,
      subscriptionTier: values.subscriptionTier || undefined,
    })
    setShowCreateForm(false)
    await reload()
  }

  return (
    <div>
      <h1>Companies</h1>
      <CompanyFilters value={filters} onChange={setFilters} />
      <button onClick={() => setShowCreateForm((v) => !v)}>{showCreateForm ? 'Cancel' : 'New company'}</button>
      {showCreateForm && <CompanyForm submitLabel="Create company" onSubmit={handleCreate} />}
      {error && <p role="alert">{error}</p>}
      {!error && (loading ? <p>Loading…</p> : <CompanyList companies={filtered} />)}
    </div>
  )
}
