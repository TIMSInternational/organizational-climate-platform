import type { User } from '../api/users'
import { useTranslation } from '../../../i18n'

export default function UserList({ users, onEdit }: { users: User[]; onEdit: (user: User) => void }) {
  const { t } = useTranslation()

  if (users.length === 0) {
    return <p>{t('users.noUsersFound')}</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>{t('users.name')}</th>
          <th>{t('users.email')}</th>
          <th>{t('users.role')}</th>
          <th>{t('common.active')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id}>
            <td>{user.name}</td>
            <td>{user.email}</td>
            <td>{user.role}</td>
            <td>{user.isActive ? t('common.yes') : t('common.no')}</td>
            <td><button onClick={() => onEdit(user)}>{t('common.edit')}</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
