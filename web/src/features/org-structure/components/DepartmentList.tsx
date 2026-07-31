import type { Department } from '../api/departments'

export default function DepartmentList({ departments, onEdit }: { departments: Department[]; onEdit: (department: Department) => void }) {
  if (departments.length === 0) {
    return <p>No departments yet.</p>
  }

  const byId = new Map(departments.map((d) => [d.id, d]))

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Parent</th>
          <th>Active</th>
          <th>Employees</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {departments.map((department) => (
          <tr key={department.id}>
            <td>{department.name}</td>
            <td>{department.parentDepartmentId ? byId.get(department.parentDepartmentId)?.name ?? '—' : '—'}</td>
            <td>{department.isActive ? 'Yes' : 'No'}</td>
            <td>{department.employeeCount}</td>
            <td><button onClick={() => onEdit(department)}>Edit</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
