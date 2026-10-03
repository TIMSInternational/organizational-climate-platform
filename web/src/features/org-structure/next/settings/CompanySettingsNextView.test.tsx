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
import { getSurvey, type SurveyDetail } from '../../../surveys/api/surveys'
import CompanyDetailPage from '../../pages/CompanyDetailPage'
import en from '../../../../i18n/en.json'
import es from '../../../../i18n/es.json'

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
vi.mock('../../../surveys/api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../surveys/api/surveys')>()),
  getSurvey: vi.fn(),
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

const running = (id: string, title: string, startDate: string) => ({
  id, title, status: 'active', startDate, endDate: '2026-10-10T00:00:00Z', responseCount: 3, targetAudienceCount: 24,
})

/** Meridiano's shape (`GET /dashboard/company-admin`, 11 Sep), with an older wave listed FIRST. */
const dashboard = {
  companyId: 'c1',
  companyName: 'Grupo Meridiano S.A.',
  surveyCount: 5,
  activeSurveyCount: 1,
  ongoingSurveys: [
    running('s-q3', 'Encuesta de Clima Q3', '2026-07-16T02:05:22Z'),
    running('s-q4', 'Encuesta de Clima Q4 (abierta)', '2026-09-03T02:03:39Z'),
  ],
} as CompanyAdminDashboard

/** `GET /surveys/{id}`: the running Q4 was created not anonymous (measured 11 Sep); the older wave is flipped so picking it shows. */
function surveyDetail(id: string): SurveyDetail {
  return id === 's-q4'
    ? ({ id, title: 'Encuesta de Clima Q4 (abierta)', settings: { anonymous: false } } as unknown as SurveyDetail)
    : ({ id, title: 'Encuesta de Clima Q3', settings: { anonymous: true } } as unknown as SurveyDetail)
}

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
    vi.mocked(getSurvey).mockReset()
    vi.mocked(getSurvey).mockImplementation(async (_base, id) => surveyDetail(id))
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

  it('reads the sender as a dash with the platform’s helper — never the company’s name as the sender — and marks nothing as sample', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(copy.language))
    const field = screen.getByText(copy.sender).parentElement as HTMLElement
    const reading = field.querySelector('[data-slot="settings-readout"]') as HTMLElement
    // The field's own child, the whole width of the column, like the artboard's.
    expect(reading.parentElement).toBe(field)
    expect(reading.className).not.toMatch(/(^|\s)w-/)
    expect(reading.textContent).toBe('—')
    expect(field.querySelector('[data-slot="field-helper"]')!.textContent).toBe(copy.senderPlatform)
    expect(field.textContent).not.toContain('Grupo Meridiano S.A.')
    expect(document.querySelectorAll('[data-slot="sample-chip"]')).toHaveLength(0)
  })

  it('draws the artboard’s six survey fields — no microclimate or AI switch — and prints the UTC zone once', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(copy.language))
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    const zone = screen.getByLabelText(new RegExp(copy.timezone)) as HTMLSelectElement
    expect(zone.value).toBe('UTC')
    expect(zone.options[zone.selectedIndex].textContent).toBe('UTC')
    expect([...zone.options].map((option) => option.textContent)).toContain('America/Costa_Rica (UTC−6)')
  })

  it('names the running survey in the anonymity helper as it was created, and the stored period in the retention helper — the artboard’s sentences with the tenant’s values', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(copy.language))
    // The latest of the running surveys by start, not the first listed.
    expect(vi.mocked(getSurvey).mock.calls.map((call) => call[1])).toEqual(['s-q4'])
    expect(screen.getByText('The Q4 survey was created as not anonymous; this value applies to new surveys only.')).toBeTruthy()
    expect(screen.getByText('How long closed responses are kept. 7 years until another period is set.')).toBeTruthy()
    cleanup()

    // The sentence follows the survey's own flag, not a fixed wording.
    vi.mocked(getSurvey).mockImplementation(
      async (_base, id) => ({ ...surveyDetail(id), settings: { anonymous: id === 's-q4' } }) as unknown as SurveyDetail,
    )
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(copy.language))
    expect(screen.getByText('The Q4 survey was created as anonymous; this value applies to new surveys only.')).toBeTruthy()
  })

  it('says only that the anonymity applies to new surveys when no survey is running, and asks for none', async () => {
    vi.mocked(getCompanyAdminDashboard).mockResolvedValue({ ...dashboard, ongoingSurveys: [] })
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(copy.language))
    expect(vi.mocked(getSurvey)).not.toHaveBeenCalled()
    expect(screen.getByText(copy.anonymityHelp)).toBeTruthy()
  })

  it('reads in Spanish singulars where a count is one — “1 activo · 1 inactivo”, “5 · 1 activa”', async () => {
    window.localStorage.setItem('preferredLocale', 'es')
    vi.mocked(listDepartments).mockResolvedValue([department({ id: 'a' }), department({ id: 'x', isActive: false, employeeCount: 0 })])
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(es.companySettings.next.language))
    const readings = screen.getByText(es.companySettings.next.departmentsReading).closest('dl') as HTMLElement
    expect(within(readings).getByText('1 activo · 1 inactivo')).toBeTruthy()
    expect(within(readings).getByText('5 · 1 activa')).toBeTruthy()
    expect(screen.getByText('La encuesta Q4 se creó como no anónima; este valor solo aplica a encuestas nuevas.')).toBeTruthy()
    expect(screen.getByText('Cuánto tiempo se conservan las respuestas cerradas. 7 años hasta que se fije otro plazo.')).toBeTruthy()
  })

  it('derives the company readings from the payloads, and prints a dash — not a zero — for a reading whose request failed', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(copy.language))
    const readings = screen.getByText(copy.departmentsReading).closest('dl') as HTMLElement
    expect(within(readings).getByText('2 active · 1 inactive')).toBeTruthy()
    expect(within(readings).getByText('20')).toBeTruthy()
    expect(within(readings).getByText('5 · 1 active')).toBeTruthy()
    // Why name and country cannot be edited here is said to a screen reader; the artboard
    // draws no line for it.
    expect(screen.getByText(copy.companyHelp).classList.contains('sr-only')).toBe(true)
    cleanup()

    vi.mocked(listDepartments).mockRejectedValue(new Error('boom'))
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByLabelText(new RegExp(copy.language))
    const failed = screen.getByText(copy.departmentsReading).closest('dl') as HTMLElement
    expect(within(failed).queryByText(/^0/)).toBeNull()
    expect(within(failed).getAllByText('—').length).toBe(2)
  })

  describe('Escala de resultados', () => {
    const withBands: CompanySettingsResponse = {
      ...stored,
      resultBands: { opportunityMin: 3, strengthMin: 4, criticalName: null, opportunityName: null, strengthName: null },
    }
    const bandsCopy = en.resultBands.settings
    beforeEach(() => {
      vi.mocked(updateCompanySettings).mockImplementation(async (_base, _id, input) => ({
        ...withBands,
        ...(input.resultBands ? { resultBands: input.resultBands } : {}),
      }))
    })
    const box = (name: string) => screen.getByLabelText(name) as HTMLInputElement

    it('draws the three bands with the default names, a fixed swatch each, and 1,00 and 5,00 fixed', async () => {
      renderAs({ role: 'company_admin', companyId: 'c1' })
      const card = (await screen.findByRole('heading', { name: bandsCopy.heading })).closest('section') as HTMLElement
      expect(box(bandsCopy.nameLabel.replace('{colour}', 'green')).value).toBe(en.resultBands.name.strength)
      expect(box(bandsCopy.nameLabel.replace('{colour}', 'red')).value).toBe(en.resultBands.name.critical)
      expect(box(bandsCopy.fromLabel.replace('{band}', en.resultBands.name.critical)).disabled).toBe(true)
      expect(box(bandsCopy.toLabel.replace('{band}', en.resultBands.name.strength)).disabled).toBe(true)
      expect(box(bandsCopy.fromLabel.replace('{band}', en.resultBands.name.opportunity)).value).toBe('3.00')
      // The colour is not a control: three "fixed" swatches and no colour input in the card.
      expect(within(card).getAllByText(bandsCopy.fixed)).toHaveLength(3)
      expect(within(card).queryByRole('textbox', { name: /colour/i })).toBeNull()
      expect(within(card).getByRole('status').textContent).toBe(bandsCopy.valid)
    })

    it('names a gap, marks the boxes that make it, and holds Save until the scale is whole again', async () => {
      renderAs({ role: 'company_admin', companyId: 'c1' })
      await screen.findByRole('heading', { name: bandsCopy.heading })
      const from = box(bandsCopy.fromLabel.replace('{band}', en.resultBands.name.opportunity))
      await userEvent.clear(from)
      await userEvent.type(from, '3.10')

      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain(bandsCopy.errorGap.replace('{from}', '2.99').replace('{to}', '3.10').replace('{example}', '3.05'))
      expect(from.getAttribute('aria-invalid')).toBe('true')
      expect(from.getAttribute('aria-describedby')).toBe(alert.id)
      expect((screen.getByRole('button', { name: copy.save }) as HTMLButtonElement).disabled).toBe(true)

      // Close the gap from the other side: the critical area now ends at 3,09.
      const to = box(bandsCopy.toLabel.replace('{band}', en.resultBands.name.critical))
      await userEvent.clear(to)
      await userEvent.type(to, '3.09')
      expect(screen.queryByRole('alert')).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: copy.save }))
      // The whole scale, as two boundaries and three names — the defaults sent as null.
      expect(vi.mocked(updateCompanySettings).mock.calls[1].slice(1)).toEqual([
        'c1',
        { resultBands: { opportunityMin: 3.1, strengthMin: 4, criticalName: null, opportunityName: null, strengthName: null } },
      ])
    })

    it('saves a renamed band by its own name, and Discard brings the scale back', async () => {
      renderAs({ role: 'company_admin', companyId: 'c1' })
      await screen.findByRole('heading', { name: bandsCopy.heading })
      const red = box(bandsCopy.nameLabel.replace('{colour}', 'red'))
      await userEvent.clear(red)
      await userEvent.type(red, 'Zona roja')
      await userEvent.click(screen.getByRole('button', { name: copy.discard }))
      expect(box(bandsCopy.nameLabel.replace('{colour}', 'red')).value).toBe(en.resultBands.name.critical)

      await userEvent.clear(box(bandsCopy.nameLabel.replace('{colour}', 'red')))
      await userEvent.type(box(bandsCopy.nameLabel.replace('{colour}', 'red')), 'Zona roja')
      await userEvent.click(screen.getByRole('button', { name: copy.save }))
      expect(vi.mocked(updateCompanySettings).mock.calls[1][2]).toEqual({
        resultBands: { opportunityMin: 3, strengthMin: 4, criticalName: 'Zona roja', opportunityName: null, strengthName: null },
      })
    })

    it('draws no card over an API that sends no scale, rather than a default in the company’s name', async () => {
      vi.mocked(updateCompanySettings).mockImplementation(async () => stored)
      renderAs({ role: 'company_admin', companyId: 'c1' })
      await screen.findByLabelText(new RegExp(copy.language))
      expect(screen.queryByRole('heading', { name: bandsCopy.heading })).toBeNull()
    })
  })
})
