import { Link } from 'react-router'
import type { Company } from '../api/companies'
import { useTranslation } from '../../../i18n'

export default function CompanyList({ companies }: { companies: Company[] }) {
  const { t } = useTranslation()

  if (companies.length === 0) {
    return <p>{t('dashboard.noCompaniesFound')}</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>{t('departments.name')}</th>
          <th>{t('dashboard.domain')}</th>
          <th>{t('dashboard.industry')}</th>
          <th>{t('dashboard.size')}</th>
          <th>{t('dashboard.country')}</th>
        </tr>
      </thead>
      <tbody>
        {companies.map((company) => (
          <tr key={company.id}>
            <td><Link to={`/admin/companies/${company.id}`}>{company.name}</Link></td>
            <td>{company.emailDomain}</td>
            <td>{company.industry}</td>
            <td>{company.size}</td>
            <td>{company.country}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
