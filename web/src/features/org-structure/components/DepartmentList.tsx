import type { Department } from '../api/departments'
import { useTranslation } from '../../../i18n'
import { Table } from '../../../components/ui'

export default function DepartmentList({ departments, onEdit }: { departments: Department[]; onEdit: (department: Department) => void }) {
  const { t } = useTranslation()

  if (departments.length === 0) {
    return <p>{t('departments.noDepartmentsYet')}</p>
  }

  const byId = new Map(departments.map((d) => [d.id, d]))

  return (
    <Table>
      <thead>
        <tr>
          <th>{t('departments.name')}</th>
          <th>{t('common.parent')}</th>
          <th>{t('common.active')}</th>
          <th>{t('dashboard.employees')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {departments.map((department) => (
          <tr key={department.id}>
            <td>{department.name}</td>
            <td>{department.parentDepartmentId ? byId.get(department.parentDepartmentId)?.name ?? '—' : '—'}</td>
            <td>{department.isActive ? t('common.yes') : t('common.no')}</td>
            <td>{department.employeeCount}</td>
            <td><button onClick={() => onEdit(department)}>{t('common.edit')}</button></td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
