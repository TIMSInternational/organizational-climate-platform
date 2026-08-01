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
  // CompanyEndpoints.GetAsync (the company *profile* view) is deliberately
  // SuperAdmin-only -- stricter than Settings/Departments/Demographic-fields
  // below, which all allow a CompanyAdmin on their own company. A CompanyAdmin
  // therefore always 403s here; that must not block the rest of the page, or
  // the Settings form and the Demographic-fields link become unreachable for
  // the exact role they were broadened for.
  const [companyProfileError, setCompanyProfileError] = useState<string | null>(null)
  const [companyProfileLoaded, setCompanyProfileLoaded] = useState(false)
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentsError, setDepartmentsError] = useState<string | null>(null)
  const [editingCompany, setEditingCompany] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null)
  const [creatingDepartment, setCreatingDepartment] = useState(false)
  const [companySettings, setCompanySettings] = useState<CompanySettingsResponse | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  async function reload() {
    if (!id) return

    try {
      const companyResult = await getCompany(baseUrl, id)
      setCompany(companyResult)
      setCompanyProfileError(null)
    } catch (err) {
      setCompany(null)
      setCompanyProfileError(err instanceof Error ? err.message : 'Failed to load company profile')
    } finally {
      setCompanyProfileLoaded(true)
    }

    try {
      const departmentsResult = await listDepartments(baseUrl, id)
      setDepartments(departmentsResult)
      setDepartmentsError(null)
    } catch (err) {
      setDepartmentsError(err instanceof Error ? err.message : 'Failed to load departments')
    }
  }

  useEffect(() => {
    reload()
  }, [id])

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
    setSettingsError(null)
    try {
      const result = await updateCompanySettings(baseUrl, id, {})
      setCompanySettings(result)
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to load company settings')
    }
  }

  if (!companyProfileLoaded) {
    return <p>Loading…</p>
  }

  return (
    <div>
      <h1>{company?.name ?? 'Company'}</h1>
      <p><Link to={`/admin/companies/${id}/users`}>Manage users</Link></p>
      <p><Link to={`/admin/companies/${id}/demographic-fields`}>Manage demographic fields</Link></p>

      {company ? (
        <>
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
        </>
      ) : (
        // Company profile detail (name/domain/industry/etc.) is SuperAdmin-only --
        // not an error state for a CompanyAdmin viewing their own company, just an
        // unavailable section. Settings/Departments/Demographic fields below are
        // unaffected since they use a broader permission check.
        companyProfileError && <p>Company profile details are only visible to a platform administrator.</p>
      )}

      <h2>Settings</h2>
      {settingsError && <p role="alert">{settingsError}</p>}
      {companySettings ? (
        <CompanySettingsForm settings={companySettings.settings} branding={companySettings.branding} onSubmit={handleUpdateSettings} />
      ) : (
        <button onClick={handleLoadSettings}>Load settings</button>
      )}

      <h2>Departments</h2>
      {departmentsError && <p role="alert">{departmentsError}</p>}
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
