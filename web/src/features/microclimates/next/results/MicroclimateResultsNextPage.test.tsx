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

function live(responseCount: number): LiveResults {
  return { sentimentScore: 0, engagementLevel: 'medium', wordCloud: WORDS, responseCount, targetParticipantCount: 20 }
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
    vi.mocked(getLiveResults).mockReset().mockResolvedValue(live(3))
    vi.mocked(getMicroclimateCsv).mockReset().mockResolvedValue(new Blob(['id'], { type: 'text/csv' }))
    vi.mocked(downloadBlobFile).mockReset()
  })

  afterEach(() => {
    cleanup()
    clearToken()
    clearCompanyNameCache()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('under the floor shows the count and not one word, even though the payload carries them', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText('de 20 esperadas · faltan 17')).toBeTruthy()
    const who = screen.getByRole('heading', { name: copy.results.whoTitle }).closest('section') as HTMLElement
    expect(within(who).getByText('3')).toBeTruthy()
    expect(screen.getByText(copy.results.figureProtected.replace('{floor}', '5'))).toBeTruthy()
    expect(screen.getByText(copy.results.wordsProtected.replace('{floor}', '5'))).toBeTruthy()
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
})
