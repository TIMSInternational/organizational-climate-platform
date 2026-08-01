import type { DemographicField } from '../api/demographicFields'

export default function DemographicFieldList({ fields, onEdit }: { fields: DemographicField[]; onEdit: (field: DemographicField) => void }) {
  if (fields.length === 0) {
    return <p>No demographic fields defined yet.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          {/* Field key is shown so an admin can see which keys are already taken --
              without it, a duplicate-key 409 (POST /admin/demographic-fields) gives
              no visual clue which of the fields below is the collision. */}
          <th>Key</th>
          <th>Label</th>
          <th>Type</th>
          <th>Required</th>
          <th>Active</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field.id}>
            <td>{field.field}</td>
            <td>{field.label}</td>
            <td>{field.type}</td>
            <td>{field.required ? 'Yes' : 'No'}</td>
            <td>{field.isActive ? 'Yes' : 'No'}</td>
            <td><button onClick={() => onEdit(field)}>Edit</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
