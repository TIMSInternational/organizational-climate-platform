import type { User } from '../api/users'

export default function UserList({ users, onEdit }: { users: User[]; onEdit: (user: User) => void }) {
  if (users.length === 0) {
    return <p>No users found.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Role</th>
          <th>Active</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id}>
            <td>{user.name}</td>
            <td>{user.email}</td>
            <td>{user.role}</td>
            <td>{user.isActive ? 'Yes' : 'No'}</td>
            <td><button onClick={() => onEdit(user)}>Edit</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
