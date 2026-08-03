import { Link } from 'react-router'
import type { Microclimate } from '../api/microclimates'
import { useTranslation } from '../../../i18n'

export default function MicroclimateList({ microclimates }: { microclimates: Microclimate[] }) {
  const { t } = useTranslation()

  if (microclimates.length === 0) {
    return <p>{t('microclimates.noMicroclimatesFound')}</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>{t('users.title')}</th>
          <th>{t('common.status')}</th>
          <th>{t('dashboard.responses')}</th>
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
