// Must match Roles.All in src/ClimateProject.Application/Auth/Roles.cs exactly -- that
// backend list has 5 values, NOT the 6-value legacy UserRole enum (no department_admin).
const ROLES = ['employee', 'supervisor', 'leader', 'company_admin', 'super_admin']

interface RoleSelectorProps {
  value: string
  onChange: (role: string) => void
  disabled?: boolean
}

export default function RoleSelector({ value, onChange, disabled }: RoleSelectorProps) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {ROLES.map((role) => (
        <option key={role} value={role}>{role}</option>
      ))}
    </select>
  )
}
