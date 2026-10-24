import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { clearCompanyNameCache } from '../../../../company-context/useCompanyName'
import { tokenFor } from '../../../../test/jwtFixture'
import { getLiveResults, getMicroclimate, type LiveResults, type MicroclimateDetail } from '../../api/microclimates'
import { getMicroclimateCsv } from '../../api/microclimateExport'
import { downloadBlobFile } from '../../../../lib/downloadBlobFile'
import MicroclimateResultsNextPage from './MicroclimateResultsNextPage'
import es from '../../../../i18n/es.json'
import { MINIMUM_RESPONDENTS } from '../../microclimatePrivacy'
import { getCompanySettings, type CompanySettingsResponse } from '../../../org-structure/api/companySettings'
import { ApiError } from '../../../../api/authFetch'

const copy = es.microclimates.next

vi.mock('../../api/microclimates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/microclimates')>()),
  getMicroclimate: vi.fn(),
  getLiveResults: vi.fn(),
}))
vi.mock('../../api/microclimateExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/microclimateExport')>()),
  getMicroclimateCsv: vi.fn(),
}))
vi.mock('../../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))
vi.mock('../../../org-structure/api/companySettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../org-structure/api/companySettings')>()),
  getCompanySettings: vi.fn(),
}))

const COMPANY = 'c1'

/** The tenant's pulse as `GET /microclimates/{id}` answered on 11 Sep, ids shortened. */
const detail: MicroclimateDetail = {
  id: 'm1',
  title: 'Pulso semanal — ¿cómo fue la semana?',
  description: 'Cinco minutos, dos preguntas, anónimo.',
  companyId: COMPANY,
  createdBy: 'u-ana',
  status: 'active',
  responseCount: 0,
  targetParticipantCount: 20,
  startTime: '2026-09-10T02:06:08.991+00:00',
  endTime: '2026-09-12T02:06:08.992+00:00',
  anonymousResponses: true,
  showLiveResults: true,
  questions: [
    { id: 'q1', text: '¿Cómo se sintió esta semana?', type: 'likert', options: null, required: true, order: 0, emojiOptions: null },
    { id: 'q2', text: 'En una palabra, ¿qué ayudaría más?', type: 'open_ended', options: null, required: false, order: 1, emojiOptions: null },
  ],
  language: 'en',
  resolvedLocale: 'es',
  fallbackFields: [],
}

const WORDS = [
  { text: 'carga', value: 4, language: 'es' },
  { text: 'apoyo', value: 2, language: 'es' },
  { text: 'visa', value: 1, language: 'es' },
]

/** One response short of the floor: the withheld case, derived so it stays withheld. */
const UNDER_FLOOR = MINIMUM_RESPONDENTS - 1

function live(responseCount: number): LiveResults {
  return {
    sentimentScore: null,
    engagementLevel: 'medium',
    wordCloud: WORDS,
    responseCount,
    targetParticipantCount: 20,
    isSuppressed: responseCount < MINIMUM_RESPONDENTS,
    suppressionReason: responseCount < MINIMUM_RESPONDENTS ? 'below_minimum_respondents' : null,
    minimumGroupSize: 5,
  }
}

function renderAs(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u-ana', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/microclimates/m1/results']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/microclimates/:id/results" element={<MicroclimateResultsNextPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

describe('MicroclimateResultsNextPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'es')
    vi.mocked(getMicroclimate).mockReset().mockResolvedValue(detail)
    vi.mocked(getLiveResults).mockReset().mockResolvedValue(live(UNDER_FLOOR))
    vi.mocked(getMicroclimateCsv).mockReset().mockResolvedValue(new Blob(['id'], { type: 'text/csv' }))
    vi.mocked(downloadBlobFile).mockReset()
    // Unread unless a test says otherwise: the page then prints the browser's zone and says so.
    vi.mocked(getCompanySettings).mockReset().mockRejectedValue(new ApiError(500, 'boom'))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    clearCompanyNameCache()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('under the floor shows the count and not one word, even though the payload carries them', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText(`de 20 esperadas · faltan ${20 - UNDER_FLOOR}`)).toBeTruthy()
    const who = screen.getByRole('heading', { name: copy.results.whoTitle }).closest('section') as HTMLElement
    expect(within(who).getByText(String(UNDER_FLOOR))).toBeTruthy()
    expect(screen.getByText(copy.results.figureProtected.replace('{floor}', String(MINIMUM_RESPONDENTS)))).toBeTruthy()
    expect(screen.getByText(copy.results.wordsProtected.replace('{floor}', String(MINIMUM_RESPONDENTS)))).toBeTruthy()
    for (const word of WORDS) expect(screen.queryByText(word.text)).toBeNull()
  })

  it('at the floor shows the words said more than once, most frequent first, and counts the one withheld', async () => {
    vi.mocked(getLiveResults).mockResolvedValue(live(6))
    renderAs({ role: 'company_admin', companyId: COMPANY })
    const list = await screen.findByRole('list', { name: es.microclimates.resultsWordsTitle })
    expect([...list.querySelectorAll('li')].map((item) => item.firstElementChild?.textContent)).toEqual(['carga', 'apoyo'])
    expect(screen.queryByText('visa')).toBeNull()
    expect(screen.getByText(/Se retienen 1 palabras dichas una sola vez/)).toBeTruthy()
  })

  it('never draws a per-question figure: the microclimate keeps none, so the board’s figure says so', async () => {
    vi.mocked(getLiveResults).mockResolvedValue(live(6))
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText(copy.results.figureNotKept)).toBeTruthy()
    expect(screen.getByText(copy.results.averageNotKept)).toBeTruthy()
    expect(screen.getByText(copy.proposed)).toBeTruthy()
  })

  it('ends without the sentiment banner (triage row 15)', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await screen.findByText(copy.results.note)
    expect(screen.queryByText(es.microclimates.sentimentUnavailableTitle)).toBeNull()
  })

  it('exports the server’s CSV through an authorized fetch, in the reader’s language', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    await userEvent.click(await screen.findByRole('button', { name: es.microclimates.exportCsv }))
    await waitFor(() => expect(downloadBlobFile).toHaveBeenCalledWith('microclimate-m1.csv', expect.any(Blob)))
    expect(vi.mocked(getMicroclimateCsv).mock.calls[0]?.slice(1)).toEqual(['m1', 'es'])
  })

  it('draws Ver en vivo and Exportar CSV at the canvas’s 34px', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    const exportButton = await screen.findByRole('button', { name: es.microclimates.exportCsv })
    expect(exportButton.className.split(' ')).toContain('h-control-canvas')
    expect(screen.getByRole('link', { name: copy.viewLive }).className.split(' ')).toContain('h-control-canvas')
  })

  it('offers a super administrator the export with no company chosen', async () => {
    renderAs({ role: 'super_admin' })
    expect(await screen.findByRole('button', { name: es.microclimates.exportCsv })).toBeTruthy()
  })

  it('offers no export to an administrator of another company, whom the export refuses', async () => {
    renderAs({ role: 'company_admin', companyId: 'c2' })
    await screen.findByText(copy.results.note)
    expect(screen.queryByRole('button', { name: es.microclimates.exportCsv })).toBeNull()
  })

  it('refuses a leader before any request is sent', async () => {
    renderAs({ role: 'leader', companyId: COMPANY })
    expect(await screen.findByText(copy.noAccessTitle)).toBeTruthy()
    expect(getMicroclimate).not.toHaveBeenCalled()
    expect(getLiveResults).not.toHaveBeenCalled()
  })

  /**
   * The company's clock (after #640 gave it to the list and the detail). The fixture's instants
   * are UTC (`02:06 UTC` on 10 and 12 Sep) and every expectation names the zone it is read in,
   * so the same assertions hold under TZ=America/Chicago and TZ=UTC.
   */
  it.each([
    ['America/Costa_Rica', '11 de septiembre a las 20:06', '9 sept 2026, 20:06', '11 sept 2026, 20:06', 'America/Costa_Rica (GMT-6)'],
    ['Asia/Tokyo', '12 de septiembre a las 11:06', '10 sept 2026, 11:06', '12 sept 2026, 11:06', 'Asia/Tokyo (GMT+9)'],
  ])('prints every date and time on the company’s zone (%s) and names it', async (zone, closes, sheetOpens, sheetCloses, label) => {
    vi.mocked(getCompanySettings).mockResolvedValue({ settings: { timezone: zone } } as unknown as CompanySettingsResponse)
    const { container } = renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText(`cierra el ${closes}; hasta entonces las cifras pueden moverse`)).toBeTruthy()
    expect(screen.getByText(sheetOpens)).toBeTruthy()
    expect(screen.getByText(sheetCloses)).toBeTruthy()
    const run = container.querySelector('[data-slot="page-meta-sentences"]') as HTMLElement
    expect(run.textContent).toContain(`Fechas y horas en la zona de la empresa: ${label}.`)
    // The session's own company: a super administrator reads whichever tenant it is in.
    expect(vi.mocked(getCompanySettings).mock.calls[0]?.[1]).toBe(COMPANY)
  })

  it('falls back to the browser’s zone when the company’s cannot be read, and says which', async () => {
    const { container } = renderAs({ role: 'company_admin', companyId: COMPANY })
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
    const time = new Date(detail.endTime).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    expect(await screen.findByText(new RegExp(`^cierra el .* a las ${time}; hasta entonces`))).toBeTruthy()
    const run = container.querySelector('[data-slot="page-meta-sentences"]') as HTMLElement
    expect(run.textContent).toContain('No se pudo leer la zona horaria de la empresa: fechas y horas en la de este navegador, ')
    expect(run.textContent).toContain(browser)
  })
})
