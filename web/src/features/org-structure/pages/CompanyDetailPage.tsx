import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCompany, updateCompany, type CompanyDetail } from '../api/companies'
import { listDepartments, createDepartment, updateDepartment, type Department } from '../api/departments'
import { updateCompanySettings, type CompanySettingsResponse } from '../api/companySettings'
import CompanyForm, { type CompanyFormValues } from '../components/CompanyForm'
import CompanySettingsForm, { type CompanySettingsFormValues } from '../components/CompanySettingsForm'
import DepartmentList from '../components/DepartmentList'
import DepartmentForm, { type DepartmentFormValues } from '../components/DepartmentForm'

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [editingCompany, setEditingCompany] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null)
  const [creatingDepartment, setCreatingDepartment] = useState(false)
  const [companySettings, setCompanySettings] = useState<CompanySettingsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    if (!id) return
    setError(null)
    try {
      const [companyResult, departmentsResult] = await Promise.all([
        getCompany(baseUrl, id),
        listDepartments(baseUrl, id),
      ])
      setCompany(companyResult)
      setDepartments(departmentsResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load company')
    }
  }

  useEffect(() => {
    reload()
  }, [id])

  if (error) {
    return <p role="alert">{error}</p>
  }

  if (!company) {
    return <p>Loading…</p>
  }

  async function handleUpdateCompany(values: CompanyFormValues) {
    await updateCompany(baseUrl, id!, values)
    setEditingCompany(false)
    await reload()
  }

  async function handleCreateDepartment(values: DepartmentFormValues) {
    await createDepartment(baseUrl, {
      companyId: id!,
      name: values.name,
      description: values.description || undefined,
      parentDepartmentId: values.parentDepartmentId || undefined,
      isActive: values.isActive,
    })
    setCreatingDepartment(false)
    await reload()
  }

  async function handleUpdateDepartment(values: DepartmentFormValues) {
    await updateDepartment(baseUrl, editingDepartment!.id, {
      name: values.name,
      description: values.description,
      isActive: values.isActive,
    })
    setEditingDepartment(null)
    await reload()
  }

  async function handleUpdateSettings(values: CompanySettingsFormValues) {
    if (!id) return
    const result = await updateCompanySettings(baseUrl, id, values)
    setCompanySettings(result)
  }

  async function handleLoadSettings() {
    if (!id) return
    setError(null)
    try {
      const result = await updateCompanySettings(baseUrl, id, {})
      setCompanySettings(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load company settings')
    }
  }

  return (
    <div>
      <h1>{company.name}</h1>
      <p><Link to={`/admin/companies/${company.id}/users`}>Manage users</Link></p>
      <p><Link to={`/admin/companies/${company.id}/demographic-fields`}>Manage demographic fields</Link></p>
      <p>{company.userCount} active users</p>

      {editingCompany ? (
        <CompanyForm
          submitLabel="Save"
          initialValues={{
            name: company.name,
            emailDomain: company.emailDomain ?? '',
            industry: company.industry ?? '',
            size: company.size ?? '',
            country: company.country ?? '',
            subscriptionTier: company.subscriptionTier ?? '',
          }}
          onSubmit={handleUpdateCompany}
        />
      ) : (
        <button onClick={() => setEditingCompany(true)}>Edit company</button>
      )}

      <h2>Settings</h2>
      {companySettings ? (
        <CompanySettingsForm settings={companySettings.settings} branding={companySettings.branding} onSubmit={handleUpdateSettings} />
      ) : (
        <button onClick={handleLoadSettings}>Load settings</button>
      )}

      <h2>Departments</h2>
      <button onClick={() => setCreatingDepartment((v) => !v)}>{creatingDepartment ? 'Cancel' : 'New department'}</button>
      {creatingDepartment && <DepartmentForm departments={departments} submitLabel="Create department" onSubmit={handleCreateDepartment} />}

      {editingDepartment && (
        <DepartmentForm
          key={editingDepartment.id}
          departments={departments}
          excludeIdFromParentOptions={editingDepartment.id}
          submitLabel="Save department"
          initialValues={{
            name: editingDepartment.name,
            description: editingDepartment.description ?? '',
            parentDepartmentId: editingDepartment.parentDepartmentId ?? '',
            isActive: editingDepartment.isActive,
          }}
          onSubmit={handleUpdateDepartment}
        />
      )}

      <DepartmentList departments={departments} onEdit={setEditingDepartment} />
    </div>
  )
}
