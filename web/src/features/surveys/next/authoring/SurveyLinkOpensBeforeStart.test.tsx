import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { COMPANY_CONTEXT_STORAGE_KEY, CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import type { SurveyDetail } from '../../api/surveys'
import type { SurveyDistributionDetail, SurveyInvitationList } from '../../api/surveyDistribution'
import SurveyDistributionNextPage from './SurveyDistributionNextPage'
import * as surveysApi from '../../api/surveys'
import * as distributionApi from '../../api/surveyDistribution'
import es from '../../../../i18n/es.json'

/**
 * The open link obeys the survey's dates: an ACTIVE survey whose start is still ahead answers
 * "Este enlace no abre ninguna encuesta", and the start date is frozen once active. PROCOMER's QR
 * demo hit exactly that on 4 Nov 2026 and needed a script to set
 * `accessRules.activeOutsideSchedule` (docs/audits/2026-11-08-operator-ui-walkthrough.md, B2).
 */

vi.mock('../../api/surveyDistribution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyDistribution')>()),
  getSurveyDistribution: vi.fn(),
  listSurveyInvitations: vi.fn(),
  updateSurveyDistribution: vi.fn(),
}))
vi.mock('../../../org-structure/api/departments', () => ({ listDepartments: vi.fn(async () => []) }))
vi.mock('../../../org-structure/api/users', () => ({ listUsers: vi.fn(async () => []) }))
vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  getSurvey: vi.fn(),
  getSurveyParticipation: vi.fn(async () => ({
    surveyId: 's1', collectsParticipantIdentity: false, answeredCount: 0, pendingCount: 0, answered: [], pending: [],
    startedCount: 0, notStartedCount: 0, roster: [], tracksIndividuals: true,
  })),
}))

const share = es.surveys.next.share
const FUTURE = '2099-03-05T14:00:00Z'
const PAST = '2026-01-05T14:00:00Z'

function survey(over: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: 's1', title: 'Demo QR', description: null, companyId: 'c1', createdBy: 'u-admin',
    type: 'periodic', serviceType: null, status: 'active', language: 'es', resolvedLocale: 'es', fallbackFields: [],
    startDate: FUTURE, endDate: '2099-03-30T05:59:00Z', responseCount: 0, targetAudienceCount: null, version: 1,
    departmentIds: [], userIds: [], questions: [],
    settings: { anonymous: true } as SurveyDetail['settings'],
    allowedStatusTransitions: ['closed'], isContentEditable: false, createdAt: '', updatedAt: '',
    ...over,
  } as SurveyDetail
}

function distribution(opensBeforeStart: boolean, publicLink: string | null = '/s/abc123def456'): SurveyDistributionDetail {
  return {
    publicLink,
    accessType: publicLink ? 'public' : 'private',
    accessRules: { requireLogin: false, allowAnonymous: true, singleResponse: false, activeOutsideSchedule: opensBeforeStart, allowedDomains: null, blockedIps: null, maxResponses: null },
  } as unknown as SurveyDistributionDetail
}

const nobodyInvited = {
  credentialMode: 'shared', invitations: [],
  summary: { total: 0, pending: 0, sent: 0, opened: 0, started: 0, completed: 0, expired: 0, withCode: 0 },
  anonymity: { anonymous: true, highestRecordableState: 'opened', suppressedStates: [], guarantee: 'Frase.' },
} as unknown as SurveyInvitationList

function open(s: SurveyDetail, d: SurveyDistributionDetail) {
  vi.mocked(surveysApi.getSurvey).mockResolvedValue(s)
  vi.mocked(distributionApi.getSurveyDistribution).mockResolvedValue(d)
  vi.mocked(distributionApi.listSurveyInvitations).mockResolvedValue(nobodyInvited)
  setToken(tokenFor({ role: 'company_admin', companyId: 'c1', sub: 'u-admin', name: 'Ana Rojas' }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={['/surveys/s1/distribution']}>
          <Routes>
            <Route path="/surveys/:surveyId/distribution" element={<SurveyDistributionNextPage />} />
          </Routes>
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

const opensBeforeStart = () => screen.getByRole('switch', { name: share.opensBeforeStartLabel })

beforeEach(() => localStorage.setItem(LOCALE_STORAGE_KEY, 'es'))
afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.clearAllMocks()
})

describe('Distribución — opening the link before the start date (B2)', () => {
  it('says why an active survey’s link is shut, and opens it with that rule alone', async () => {
    open(survey(), distribution(false))
    expect(await screen.findByTestId('link-waits-for-start')).toBeTruthy()
    expect(screen.getByTestId('link-waits-for-start').textContent).toContain('5 mar')
    expect(opensBeforeStart().getAttribute('aria-checked')).toBe('false')

    vi.mocked(distributionApi.updateSurveyDistribution).mockResolvedValue(distribution(true))
    vi.mocked(distributionApi.getSurveyDistribution).mockResolvedValue(distribution(true))
    await userEvent.click(opensBeforeStart())

    await waitFor(() => expect(distributionApi.updateSurveyDistribution).toHaveBeenCalledTimes(1))
    // Only the one rule: the server applies access rules field by field, so nothing else moves.
    expect(vi.mocked(distributionApi.updateSurveyDistribution).mock.calls[0].slice(1)).toEqual([
      's1',
      { accessRules: { activeOutsideSchedule: true } },
    ])
    expect(await screen.findByText(share.opensBeforeStartOn)).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('link-waits-for-start')).toBeNull())
    expect(opensBeforeStart().getAttribute('aria-checked')).toBe('true')
  })

  it('stays quiet once the start has passed: the dates are not what shuts the link', async () => {
    open(survey({ startDate: PAST }), distribution(false))
    expect(await screen.findByRole('switch', { name: share.opensBeforeStartLabel })).toBeTruthy()
    expect(screen.queryByTestId('link-waits-for-start')).toBeNull()
  })

  it('offers nothing to open where there is no link', async () => {
    open(survey(), distribution(false, null))
    await screen.findByTestId('step-audience')
    expect(screen.queryByRole('switch', { name: share.opensBeforeStartLabel })).toBeNull()
    expect(screen.queryByTestId('link-waits-for-start')).toBeNull()
  })

  it('shows the rule on a closed survey without a control that would earn a 409', async () => {
    open(survey({ status: 'closed', startDate: PAST, allowedStatusTransitions: ['archived'] }), distribution(true))
    expect((await screen.findByRole('switch', { name: share.opensBeforeStartLabel })).hasAttribute('disabled')).toBe(true)
  })
})
