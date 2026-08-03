import { Link } from 'react-router'
import type { Company } from '../api/companies'

export default function CompanyList({ companies }: { companies: Company[] }) {
  if (companies.length === 0) {
    return <p>No companies found.</p>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Domain</th>
          <th>Industry</th>
          <th>Size</th>
          <th>Country</th>
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
