import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import { updateCompanySettings, type CompanySettingsResponse } from '../../api/companySettings'
import { listDepartments, type Department } from '../../api/departments'
import { getCompanyAdminDashboard, type CompanyAdminDashboard } from '../../../dashboard/api/dashboard'
import CompanyDetailPage from '../../pages/CompanyDetailPage'
import en from '../../../../i18n/en.json'

const copy = en.companySettings.next

vi.mock('../../api/companySettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/companySettings')>()),
  updateCompanySettings: vi.fn(),
}))
vi.mock('../../api/departments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/departments')>()),
  listDepartments: vi.fn(),
}))
vi.mock('../../../dashboard/api/dashboard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dashboard/api/dashboard')>()),
  getCompanyAdminDashboard: vi.fn(),
}))

/** `CompanySettingsResponse` with the entity defaults (`Company.cs`), as the fixture carries it. */
const stored: CompanySettingsResponse = {
  companyId: 'c1',
  settings: {
    surveyFrequency: 'quarterly',
    microclimateEnabled: true,
    aiInsightsEnabled: true,
    anonymousSurveys: false,
    dataRetentionDays: 2555,
    timezone: 'UTC',
    language: 'en',
  },
  branding: { logoUrl: null, primaryColor: '#3B82F6', secondaryColor: '#1E40AF', fontFamily: 'Inter', customCss: null },
}

function department(over: Partial<Department>): Department {
  return { id: 'd', companyId: 'c1', name: 'D', description: null, parentDepartmentId: null, isActive: true, employeeCount: 5, ...over }
}

const dashboard = {
  companyId: 'c1',
  companyName: 'Grupo Meridiano S.A.',
  surveyCount: 5,
  activeSurveyCount: 1,
} as CompanyAdminDashboard

function renderAs(claims: Record<string, unknown>, id = 'c1') {
  setToken(tokenFor({ sub: 'u1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={[`/admin/companies/${id}`]}>
          <Routes>
            <Route path="/admin/companies/:id" element={<CompanyDetailPage />} />
          </Routes>
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

describe('CompanySettingsNextView (/admin/companies/:id for a company administrator)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
    vi.mocked(updateCompanySettings).mockReset()
    vi.mocked(updateCompanySettings).mockImplementation(async (_base, _id, input) => ({
      ...stored,
      settings: { ...stored.settings, ...(input.language ? { language: input.language } : {}) },
    }))
    vi.mocked(listDepartments).mockReset()
    vi.mocked(listDepartments).mockResolvedValue([
      department({ id: 'a', employeeCount: 6 }),
      department({ id: 'b', employeeCount: 14 }),
      department({ id: 'x', isActive: false, employeeCount: 0 }),
    ])
    vi.mocked(getCompanyAdminDashboard).mockReset()
    vi.mocked(getCompanyAdminDashboard).mockResolvedValue(dashboard)
  })
  afterEach(() => {
    cleanup()
    clearToken()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('reads the settings with an empty body, then saves the language — and only the language — on the settings PUT', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    const language = await screen.findByLabelText(new RegExp(copy.language))
    expect(vi.mocked(updateCompanySettings).mock.calls[0].slice(1)).toEqual(['c1', {}])
    expect((language as HTMLSelectElement).value).toBe('en')

    await userEvent.selectOptions(language, 'es')
    await userEvent.click(screen.getByRole('button', { name: copy.save }))

    expect(vi.mocked(updateCompanySettings)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(updateCompanySettings).mock.calls[1].slice(1)).toEqual(['c1', { language: 'es' }])
    expect(await screen.findByText(copy.saved)).toBeTruthy()
    expect((screen.getByLabelText(new RegExp(copy.language)) as HTMLSelectElement).value).toBe('es')
  })

  it('sends nothing when nothing changed, and says so', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(copy.language))
    await userEvent.click(screen.getByRole('button', { name: copy.save }))
    expect(vi.mocked(updateCompanySettings)).toHaveBeenCalledTimes(1)
    expect(screen.getByText(copy.nothingToSave)).toBeTruthy()
  })

  it('offers another company’s administrator nothing, and asks the server nothing', async () => {
    renderAs({ role: 'company_admin', companyId: 'c2' })
    expect(await screen.findByText(copy.notAllowedTitle)).toBeTruthy()
    expect(vi.mocked(updateCompanySettings)).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: copy.save })).toBeNull()
  })

  it('offers a leader nothing either: the settings PUT is Roles.Admin', async () => {
    renderAs({ role: 'leader', companyId: 'c1' })
    expect(await screen.findByText(copy.notAllowedTitle)).toBeTruthy()
    expect(vi.mocked(updateCompanySettings)).not.toHaveBeenCalled()
  })

  it('marks the sender name — no endpoint stores one — as the only sample region', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(copy.language))
    const chips = document.querySelectorAll('[data-slot="sample-chip"]')
    expect(chips).toHaveLength(1)
    expect(chips[0].closest('div')?.textContent).toContain('Grupo Meridiano S.A.')
  })

  it('derives the company readings from the payloads, and prints a dash — not a zero — for a reading whose request failed', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(copy.language))
    const readings = screen.getByText(copy.departmentsReading).closest('dl') as HTMLElement
    expect(within(readings).getByText('2 active · 1 inactive')).toBeTruthy()
    expect(within(readings).getByText('20')).toBeTruthy()
    expect(within(readings).getByText('5 · 1 active')).toBeTruthy()
    cleanup()

    vi.mocked(listDepartments).mockRejectedValue(new Error('boom'))
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(copy.language))
    const failed = screen.getByText(copy.departmentsReading).closest('dl') as HTMLElement
    expect(within(failed).queryByText(/^0/)).toBeNull()
    expect(within(failed).getAllByText('—').length).toBe(2)
  })
})
