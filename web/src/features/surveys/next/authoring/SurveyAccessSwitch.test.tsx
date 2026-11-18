import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { COMPANY_CONTEXT_STORAGE_KEY, CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import type { SurveyCredentialMode, SurveyDetail } from '../../api/surveys'
import type { SurveyInvitationList } from '../../api/surveyDistribution'
import type { CredentialMode } from '../../../org-structure/api/companySettings'
import SurveyDistributionNextPage from './SurveyDistributionNextPage'
import { linkOffModeFor } from './useDistributionModel'
import * as surveysApi from '../../api/surveys'
import * as distributionApi from '../../api/surveyDistribution'
import * as settingsApi from '../../../org-structure/api/companySettings'
import es from '../../../../i18n/es.json'

/**
 * «Cómo entran las personas», through the page and its model (review of 2026-11-18).
 *
 * Turning the switch off always sent `shared`. A `per_survey` survey switched on and off again
 * landed in a mode it never had -- and one the API then freezes it in (`shared` -> `per_survey` is
 * `credential_mode_frozen`), in a company whose accounts have no password. Off now returns the
 * survey to the mode it had, or to the company's.
 */

vi.mock('../../api/surveyDistribution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveyDistribution')>()),
  getSurveyDistribution: vi.fn(async () => null),
  listSurveyInvitations: vi.fn(),
}))
vi.mock('../../../org-structure/api/departments', () => ({ listDepartments: vi.fn(async () => []) }))
vi.mock('../../../org-structure/api/users', () => ({ listUsers: vi.fn(async () => []) }))
vi.mock('../../../org-structure/api/companySettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../org-structure/api/companySettings')>()),
  getCompanySettings: vi.fn(),
}))
vi.mock('../../../org-structure/api/companies', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listCompanies: vi.fn(async () => [{ id: 'c1', name: 'PROCOMER' }]),
}))
vi.mock('../../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/surveys')>()),
  getSurvey: vi.fn(),
  setSurveyCredentialMode: vi.fn(),
  getSurveyParticipation: vi.fn(async () => ({
    surveyId: 's1', collectsParticipantIdentity: true, answeredCount: 0, pendingCount: 0, answered: [], pending: [],
    startedCount: 0, notStartedCount: 0, roster: [], tracksIndividuals: true,
  })),
}))

const L = es.surveys.next.distribution.link

function survey(mode: SurveyCredentialMode): SurveyDetail {
  return {
    id: 's1', title: 'Clima 2026', description: null, companyId: 'c1', createdBy: 'u-admin',
    type: 'periodic', serviceType: null, status: 'active', language: 'es', resolvedLocale: 'es', fallbackFields: [],
    startDate: '2026-11-18T12:00:00Z', endDate: '2026-12-15T05:59:00Z', responseCount: 0, targetAudienceCount: null, version: 1,
    departmentIds: [], userIds: [], questions: [],
    settings: { anonymous: true, credentialMode: mode } as unknown as SurveyDetail['settings'],
    allowedStatusTransitions: ['closed'], isContentEditable: false, createdAt: '', updatedAt: '',
  } as SurveyDetail
}

function invitations(mode: SurveyCredentialMode): SurveyInvitationList {
  return {
    credentialMode: mode,
    invitations: [],
    summary: { total: 0, pending: 0, sent: 0, opened: 0, started: 0, completed: 0, revoked: 0, expired: 0, withCode: 0 },
    anonymity: { anonymous: true, highestRecordableState: 'opened', suppressedStates: ['started', 'completed'], guarantee: 'Frase.' },
  }
}

/**
 * The page over a fake API whose survey really changes mode: `setSurveyCredentialMode` writes it,
 * and the re-read after the switch returns it. `companyMode` null = the company's settings could
 * not be read.
 */
function open(initial: SurveyCredentialMode, companyMode: CredentialMode | null) {
  let mode = initial
  vi.mocked(surveysApi.getSurvey).mockImplementation(async () => survey(mode))
  vi.mocked(distributionApi.listSurveyInvitations).mockImplementation(async () => invitations(mode))
  vi.mocked(surveysApi.setSurveyCredentialMode).mockImplementation(async (_base, _id, next) => {
    mode = next
  })
  vi.mocked(settingsApi.getCompanySettings).mockImplementation(async () => {
    if (companyMode === null) throw new Error('unread')
    return { companyId: 'c1', settings: { timezone: 'America/Costa_Rica', credentialMode: companyMode }, branding: {} } as never
  })
  setToken(tokenFor({ role: 'company_admin', companyId: 'c1', sub: 'u-admin', name: 'Ana Rojas' }))
  render(
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
  return () => mode
}

async function accessSwitch() {
  return within(await screen.findByTestId('access-mode')).getByRole('switch', { name: L.modeLabel })
}

beforeEach(() => localStorage.setItem(LOCALE_STORAGE_KEY, 'es'))
afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.clearAllMocks()
})

describe('linkOffModeFor — where switching personal_link off takes a survey', () => {
  it("is the survey's own mode, else the company's, else nothing -- never a guessed shared", () => {
    expect(linkOffModeFor('per_survey', 'shared')).toBe('per_survey')
    expect(linkOffModeFor('shared', 'per_survey')).toBe('shared')
    expect(linkOffModeFor('personal_link', 'per_survey')).toBe('per_survey')
    expect(linkOffModeFor('personal_link', 'shared')).toBe('shared')
    expect(linkOffModeFor('personal_link', null)).toBeNull()
  })
})

describe('«Cómo entran las personas» on Distribución', () => {
  it('a per_survey survey switched on and then off is per_survey again, not shared', async () => {
    // The company says shared on purpose: the survey's own mode is what it goes back to.
    const modeNow = open('per_survey', 'shared')

    const toggle = await accessSwitch()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(toggle)
    await waitFor(() => expect(modeNow()).toBe('personal_link'))
    await waitFor(async () => expect((await accessSwitch()).getAttribute('aria-checked')).toBe('true'))

    await userEvent.click(await accessSwitch())
    await waitFor(() => expect(vi.mocked(surveysApi.setSurveyCredentialMode).mock.calls).toHaveLength(2))
    expect(vi.mocked(surveysApi.setSurveyCredentialMode).mock.calls.map((call) => call[2])).toEqual(['personal_link', 'per_survey'])
    expect(modeNow()).toBe('per_survey')
  })

  it("a survey that was already personal_link when the page opened goes back to the company's mode", async () => {
    open('personal_link', 'per_survey')

    const toggle = await accessSwitch()
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(toggle)

    // (The base URL is the build's `VITE_API_BASE_URL`, unset under test: only the id and the mode are read.)
    await waitFor(() => expect(vi.mocked(surveysApi.setSurveyCredentialMode).mock.calls.map((call) => [call[1], call[2]])).toEqual([['s1', 'per_survey']]))
  })

  it("does not offer off at all when neither the survey's former mode nor the company's is known", async () => {
    open('personal_link', null)

    const toggle = await accessSwitch()
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect((toggle as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(toggle)
    expect(vi.mocked(surveysApi.setSurveyCredentialMode)).not.toHaveBeenCalled()
  })
})
