import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'
import { tokenFor } from '../../../test/jwtFixture'
import { ApiError } from '../../../api/authFetch'
import { getSurvey, type SurveyDetail } from '../api/surveys'
import { getCompanySettings, type CompanySettingsResponse } from '../../org-structure/api/companySettings'
import { compareSurveyVersions, getSurveyHistory, listSurveyVersions, type SurveyAuditEntry, type SurveyVersionDetail, type SurveyVersionSummary } from './api'
import SurveyHistoryPage from './SurveyHistoryPage'
import es from '../../../i18n/es.json'

const copy = es.surveys.next.history

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getSurveyHistory: vi.fn(),
  listSurveyVersions: vi.fn(),
  compareSurveyVersions: vi.fn(),
}))
vi.mock('../api/surveys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/surveys')>()),
  getSurvey: vi.fn(),
}))
vi.mock('../../org-structure/api/companySettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../org-structure/api/companySettings')>()),
  getCompanySettings: vi.fn(),
}))

/** ESPH's survey as `GET /surveys/{id}` returns it — with 412 responses the page must not print. */
const survey = {
  id: 's-esph', companyId: 'c1', title: 'Clima ESPH 2026', responseCount: 412, status: 'active', language: 'es',
} as unknown as SurveyDetail

function entry(overrides: Partial<SurveyAuditEntry>): SurveyAuditEntry {
  return {
    id: 'e', surveyId: 's-esph', action: 'created', entityType: 'survey', entityId: null, changes: null, userId: 'u1',
    userName: 'Irene Vargas', userEmail: 'irene@acme.test', userRole: 'company_admin', timestamp: '2026-10-15T15:00:00Z',
    ipAddress: '203.0.113.77', ...overrides,
  }
}

const entries: SurveyAuditEntry[] = [
  entry({ id: 'e4', action: 'status_changed', entityType: 'status', changes: { from: 'scheduled', to: 'active' }, timestamp: '2026-10-19T12:00:00Z' }),
  entry({ id: 'e3', action: 'version_created', entityType: 'version', changes: { versionNumber: 2 }, timestamp: '2026-10-18T23:30:00Z', userName: 'Federico T.', userRole: 'super_admin' }),
  entry({ id: 'e2', action: 'updated', changes: { fields: ['endDate', 'questions[0].text', 'settings.anonymous'] }, timestamp: '2026-10-17T20:10:00Z' }),
  entry({ id: 'e1', action: 'created', timestamp: '2026-10-15T15:00:00Z' }),
]

function summary(n: number, overrides: Partial<SurveyVersionSummary> = {}): SurveyVersionSummary {
  return {
    id: `v${n}`, surveyId: 's-esph', versionNumber: n, title: 'Clima ESPH 2026', language: 'es', resolvedLocale: 'es', fallbackFields: [],
    reason: n === 1 ? 'publish' : 'republish', changes: [], questionCount: 82, createdBy: 'u1', createdByName: 'Irene Vargas',
    createdByEmail: 'irene@acme.test', createdAt: '2026-10-16T14:00:00Z', isCurrent: false, collectedResponses: false, ...overrides,
  }
}

function detail(n: number, text: string, endDate: string): SurveyVersionDetail {
  return {
    ...summary(n), description: null, type: 'periodic', startDate: '2026-10-19T12:00:00Z', endDate, departmentIds: [], targetAudienceCount: 865,
    questions: [{ id: 'q', text, type: 'likert', options: null, scaleMin: 1, scaleMax: 5, scaleLabelMin: null, scaleLabelMax: null, required: true, commentRequired: false, commentPrompt: null, order: 0, category: 'workload' }],
    settings: { anonymous: true } as SurveyVersionDetail['settings'],
  } as SurveyVersionDetail
}

function renderPage(claims: Record<string, unknown> = { role: 'company_admin', companyId: 'c1' }) {
  setToken(tokenFor({ sub: 'u1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={['/surveys/s-esph/history']}>
          <Routes>
            <Route path="/surveys/:id/history" element={<SurveyHistoryPage />} />
          </Routes>
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

describe('SurveyHistoryPage (/surveys/:id/history)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'es')
    vi.mocked(getSurvey).mockReset().mockResolvedValue(survey)
    vi.mocked(getCompanySettings).mockReset().mockResolvedValue({ settings: { timezone: 'America/Costa_Rica' } } as unknown as CompanySettingsResponse)
    vi.mocked(getSurveyHistory).mockReset().mockResolvedValue({ surveyId: 's-esph', entries })
    vi.mocked(listSurveyVersions).mockReset().mockResolvedValue({
      surveyId: 's-esph', currentVersion: 2, responseCount: 412,
      versions: [summary(1), summary(2, { isCurrent: true, collectedResponses: true, changes: ['endDate', 'questions[0].text'] })],
    })
    vi.mocked(compareSurveyVersions).mockReset().mockResolvedValue({
      surveyId: 's-esph',
      from: detail(1, 'Tengo una carga razonable', '2026-10-27T05:59:00Z'),
      to: detail(2, 'Mi carga de trabajo es razonable', '2026-10-28T05:59:00Z'),
      changes: ['endDate', 'questions[0].text'],
    })
  })
  afterEach(() => {
    cleanup()
    clearToken()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('lists who changed what and when, on the company clock, in Spanish', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: new RegExp(copy.title) })).toBeTruthy()
    expect(screen.getByText(copy.descriptionCompanyZone.replace('{zone}', 'America/Costa_Rica'))).toBeTruthy()
    const rows = [...document.querySelectorAll('[data-slot="history-entry"]')]
    expect(rows).toHaveLength(4)
    expect(within(rows[0] as HTMLElement).getByText('Cambió el estado: Programada → Activa')).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText('Guardó la versión 2')).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText('Por Federico T. · Superadministración')).toBeTruthy()
    expect(within(rows[2] as HTMLElement).getByText('Editó la encuesta (3 campos)')).toBeTruthy()
    expect(within(rows[2] as HTMLElement).getAllByRole('listitem').map((node) => node.textContent)).toEqual(['Cierre', 'Pregunta 1 · texto', 'Anónima'])
    // 12:00 UTC on 19 Oct is 06:00 in Costa Rica.
    const time = rows[0].querySelector('time') as HTMLTimeElement
    expect(time.getAttribute('dateTime')).toBe('2026-10-19T12:00:00Z')
    expect(time.textContent).toMatch(/19/)
    expect(time.textContent).toMatch(/6:00|06:00/)
  })

  it('never prints a response count, the "collected responses" flag or an IP address', async () => {
    renderPage()
    await screen.findByRole('heading', { name: new RegExp(copy.title) })
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('412')
    expect(text).not.toContain('203.0.113.77')
    expect(text).not.toMatch(/respuestas recogidas|responses collected/i)
  })

  it('lists the published versions, newest first, and shows the newest one’s difference with the previous', async () => {
    renderPage()
    await screen.findByRole('heading', { name: new RegExp(copy.title) })
    const versions = [...document.querySelectorAll('[data-slot="history-version"]')] as HTMLElement[]
    expect(versions.map((node) => node.querySelector('.font-semibold')?.textContent)).toEqual(['Versión 2', 'Versión 1'])
    expect(within(versions[0]).getByText(copy.current)).toBeTruthy()
    expect(within(versions[0]).getByText('2 cambios desde la versión 1.')).toBeTruthy()
    expect(within(versions[1]).getByText(copy.firstVersion)).toBeTruthy()
    expect(within(versions[1]).queryByRole('button', { name: copy.showChanges })).toBeNull()
    // The newest version opens its difference with the previous one without a click.
    expect(within(versions[0]).getByRole('button', { name: copy.hideChanges }).getAttribute('aria-expanded')).toBe('true')
    expect(vi.mocked(compareSurveyVersions)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(compareSurveyVersions).mock.calls[0].slice(1, 4)).toEqual(['s-esph', 1, 2])
    const rows = await within(versions[0]).findAllByRole('row')
    const body = rows.filter((row) => row.getAttribute('data-slot') === 'diff-row')
    expect(body.map((row) => row.querySelector('th')?.textContent)).toEqual(['Cierre', 'Pregunta 1 · texto'])
    expect(body[1].textContent).toContain('Tengo una carga razonable')
    expect(body[1].textContent).toContain('Mi carga de trabajo es razonable')
    // 05:59 UTC on the 28th is 23:59 on the 27th in Costa Rica: the company's day, not UTC's.
    expect(body[0].textContent).toMatch(/27[^0-9]/)

    // Closed and reopened, it does not ask again.
    await userEvent.click(within(versions[0]).getByRole('button', { name: copy.hideChanges }))
    expect(within(versions[0]).queryAllByRole('row')).toHaveLength(0)
    await userEvent.click(within(versions[0]).getByRole('button', { name: copy.showChanges }))
    expect(await within(versions[0]).findAllByRole('row')).not.toHaveLength(0)
    expect(vi.mocked(compareSurveyVersions)).toHaveBeenCalledTimes(1)
  })

  it('offers no way to restore a version, and says why', async () => {
    renderPage()
    await screen.findByRole('heading', { name: new RegExp(copy.title) })
    expect(screen.queryByRole('button', { name: /restaurar|restore|revertir/i })).toBeNull()
    expect(screen.getByText(copy.noRestore)).toBeTruthy()
  })

  it('says when the company clock could not be read, and which zone it used instead', async () => {
    vi.mocked(getCompanySettings).mockRejectedValue(new Error('boom'))
    renderPage({ role: 'super_admin' })
    await screen.findByRole('heading', { name: new RegExp(copy.title) })
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(screen.getByText(copy.descriptionBrowserZone.replace('{zone}', zone))).toBeTruthy()
  })

  it('renders the API’s refusal in its own words, not the server’s', async () => {
    vi.mocked(getSurveyHistory).mockRejectedValue(new ApiError(403, 'Forbidden'))
    renderPage({ role: 'company_admin', companyId: 'c2' })
    expect(await screen.findByText(copy.forbiddenTitle)).toBeTruthy()
    expect(screen.queryByText('Forbidden')).toBeNull()
    cleanup()

    vi.mocked(getSurvey).mockRejectedValue(new ApiError(404, 'Survey not found'))
    renderPage()
    expect(await screen.findByText(copy.missingTitle)).toBeTruthy()
  })

  it('says a never-published survey has no versions yet', async () => {
    vi.mocked(listSurveyVersions).mockResolvedValue({ surveyId: 's-esph', currentVersion: 1, responseCount: 0, versions: [] })
    renderPage()
    expect(await screen.findByText(copy.noVersions)).toBeTruthy()
    expect(screen.getByText(copy.noVersionsBody)).toBeTruthy()
  })
})
