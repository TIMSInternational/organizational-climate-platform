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
    await updateUser(baseUrl, editingUser.id, { name: values.name, isActive: values.isActive })
    if (values.role !== editingUser.role) {
      await updateUserRole(baseUrl, editingUser.id, values.role)
    }
    setEditingUser(null)
    await reload()
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
