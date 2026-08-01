import type { DemographicField } from '../api/demographicFields'

export default function DemographicFieldList({ fields, onEdit }: { fields: DemographicField[]; onEdit: (field: DemographicField) => void }) {
  if (fields.length === 0) {
    return <p>No demographic fields defined yet.</p>
  }

  return (
    <table>
      <thead>
        <tr>
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
