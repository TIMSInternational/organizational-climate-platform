import { describe, expect, it } from 'vitest'
import type { SuperAdminDashboard } from '../../../dashboard/api/dashboard'
import type { SurveyListItem } from '../../../surveys/api/surveys'
import type { Company } from '../../api/companies'
import { NO_PLAN, composeCompanyRows, filterCompanyRows, isUnconfigured } from './companiesList'

const companies: Company[] = [
  { id: 'v', name: 'Verify Co', emailDomain: 'verifyco.test', industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-07-31T20:42:50Z' },
  { id: 'a', name: 'Acme Corporation', emailDomain: 'acme.test', industry: 'Manufacturing', size: '500-1000', country: 'Colombia', subscriptionTier: 'enterprise', createdAt: '2026-08-07T15:44:32Z' },
  { id: 'm', name: 'Grupo Meridiano S.A.', emailDomain: 'meridiano.test', industry: 'Servicios', size: 'medium', country: 'Costa Rica', subscriptionTier: 'basic', createdAt: '2026-09-10T01:58:51Z' },
]

const dashboard: SuperAdminDashboard = {
  companyCount: 3,
  userCount: 92,
  activeUserCount: 91,
  surveyCount: 3,
  activeSurveyCount: 2,
  responseCount: 149,
  completedResponseCount: 149,
  companies: [
    { id: 'm', name: 'Grupo Meridiano S.A.', userCount: 42, activeSurveyCount: 1, completedResponseCount: 76, createdAt: '2026-09-10T01:58:51Z' },
    { id: 'a', name: 'Acme Corporation', userCount: 45, activeSurveyCount: 1, completedResponseCount: 73, createdAt: '2026-08-07T15:44:32Z' },
    { id: 'v', name: 'Verify Co', userCount: 1, activeSurveyCount: 0, completedResponseCount: 0, createdAt: '2026-07-31T20:42:50Z' },
  ],
}

function survey(companyId: string, status: string, title: string, endDate: string): SurveyListItem {
  return {
    id: `${companyId}:${title}`,
    title,
    companyId,
    type: 'periodic',
    status,
    language: 'both',
    startDate: '2026-09-01T00:00:00Z',
    endDate,
    responseCount: 3,
    targetAudienceCount: 24,
    questionCount: 6,
    createdAt: '2026-09-01T00:00:00Z',
  }
}

const surveys = [
  survey('m', 'active', 'Encuesta de Clima Q4 (abierta)', '2026-10-10T02:03:39Z'),
  survey('m', 'closed', 'Encuesta de Clima Q3', '2026-08-06T02:05:22Z'),
  survey('a', 'active', 'Encuesta de Clima Q4 (abierta)', '2026-09-26T18:21:20Z'),
]

describe('composeCompanyRows', () => {
  const rows = composeCompanyRows(companies, dashboard, surveys)

  it('orders by activity, whatever order the list came in', () => {
    expect(rows.map((row) => row.name)).toEqual(['Grupo Meridiano S.A.', 'Acme Corporation', 'Verify Co'])
  })

  it('takes people and active surveys from the platform read and the open wave from the survey list', () => {
    expect(rows[0]).toMatchObject({ people: 42, activeSurveyCount: 1, surveyCount: 2, openSurvey: { code: 'Q4', endDate: '2026-10-10T02:03:39Z' } })
    expect(rows[2]).toMatchObject({ people: 1, activeSurveyCount: 0, surveyCount: 0, openSurvey: null })
  })

  it('leaves what it could not read as unknown rather than as zero', () => {
    const [first] = composeCompanyRows(companies, null, null)
    expect(first).toMatchObject({ people: null, activeSurveyCount: null, surveyCount: null, openSurvey: null })
  })
})

describe('filterCompanyRows', () => {
  const rows = composeCompanyRows(companies, dashboard, surveys)
  const names = (search: string, plan: string) => filterCompanyRows(rows, search, plan).map((row) => row.name)

  it('searches the name, the email domain and the sector', () => {
    expect(names('acme.test', '')).toEqual(['Acme Corporation'])
    expect(names('SERVICIOS', '')).toEqual(['Grupo Meridiano S.A.'])
    expect(names('verify', '')).toEqual(['Verify Co'])
  })

  it('filters by plan, where "no plan" is the tenants with none', () => {
    expect(names('', 'enterprise')).toEqual(['Acme Corporation'])
    expect(names('', NO_PLAN)).toEqual(['Verify Co'])
    expect(names('', '')).toHaveLength(3)
  })
})

describe('isUnconfigured', () => {
  const rows = composeCompanyRows(companies, dashboard, surveys)

  it('calls a company unconfigured only when nothing at all was filled in', () => {
    expect(isUnconfigured(rows[2])).toBe(true)
    expect(isUnconfigured(rows[0])).toBe(false)
    expect(isUnconfigured({ ...rows[2], country: 'Panamá' })).toBe(false)
  })
})
