import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { listUsers, updateUser, updateUserRole, type User } from '../api/users'
import UserList from '../components/UserList'
import UserFilters, { type UserFiltersValue } from '../components/UserFilters'
import UserForm, { type UserFormValues } from '../components/UserForm'

export default function UsersListPage() {
  const { companyId } = useParams<{ companyId: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<UserFiltersValue>({ search: '' })
  const [editingUser, setEditingUser] = useState<User | null>(null)

  async function reload() {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const result = await listUsers(baseUrl, companyId)
      setUsers(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [companyId])

  const filtered = users.filter((user) => {
    const search = filters.search.toLowerCase()
    if (!search) return true
    return user.name.toLowerCase().includes(search) || user.email.toLowerCase().includes(search)
  })

  async function handleUpdate(values: UserFormValues) {
    if (!editingUser) return
    // updateUser and updateUserRole are two separate backend calls with no server-side
    // transaction between them (role changes are intentionally SuperAdmin-only and
    // stricter, per Global Constraints). If updateUser succeeds but updateUserRole then
    // fails (e.g. a CompanyAdmin gets a 403), the profile change is already persisted.
    // Always reload() -- even on failure -- so the table reflects whatever the server
    // actually committed instead of showing stale pre-edit values, and only clear
    // editingUser (closing the form) once both calls have actually succeeded so the
    // admin can see the error and retry the remaining change.
    try {
      await updateUser(baseUrl, editingUser.id, { name: values.name, isActive: values.isActive })
      if (values.role !== editingUser.role) {
        await updateUserRole(baseUrl, editingUser.id, values.role)
      }
      setEditingUser(null)
    } finally {
      await reload()
    }
  }

  if (error) {
    return <p role="alert">{error}</p>
  }

  return (
    <div>
      <h1>Users</h1>
      <UserFilters value={filters} onChange={setFilters} />
      {editingUser && (
        <UserForm key={editingUser.id} user={editingUser} canChangeRole onSubmit={handleUpdate} />
      )}
      {loading ? <p>Loading…</p> : <UserList users={filtered} onEdit={setEditingUser} />}
    </div>
  )
}
