import { Link } from 'react-router'
import type { Microclimate } from '../api/microclimates'

export default function MicroclimateList({ microclimates }: { microclimates: Microclimate[] }) {
  if (microclimates.length === 0) {
    return <p>No microclimates found.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Status</th>
          <th>Responses</th>
        </tr>
      </thead>
      <tbody>
        {microclimates.map((m) => (
          <tr key={m.id}>
            <td><Link to={`/microclimates/${m.id}`}>{m.title}</Link></td>
            <td>{m.status}</td>
            <td>{m.responseCount} / {m.targetParticipantCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
