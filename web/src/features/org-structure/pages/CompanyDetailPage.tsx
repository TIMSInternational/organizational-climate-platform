import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getCompany, updateCompany, type CompanyDetail } from '../api/companies'
import { listDepartments, createDepartment, updateDepartment, type Department } from '../api/departments'
import CompanyForm, { type CompanyFormValues } from '../components/CompanyForm'
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

  return (
    <div>
      <h1>{company.name}</h1>
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
