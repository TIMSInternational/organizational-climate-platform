import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { clearCompanyNameCache } from '../../../../company-context/useCompanyName'
import { tokenFor } from '../../../../test/jwtFixture'
import {
  getLiveResults,
  getMicroclimate,
  listMicroclimates,
  type Microclimate,
  type MicroclimateDetail,
} from '../../api/microclimates'
import MicroclimateAnalyticsNextPage from './MicroclimateAnalyticsNextPage'
import es from '../../../../i18n/es.json'

const copy = es.microclimates.next.analytics

vi.mock('../../api/microclimates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/microclimates')>()),
  listMicroclimates: vi.fn(),
  getMicroclimate: vi.fn(),
  getLiveResults: vi.fn(),
}))

const COMPANY = 'c1'

function session(over: Partial<Microclimate>): Microclimate {
  return {
    id: 'm1',
    title: 'Pulso semanal — ¿cómo fue la semana?',
    companyId: COMPANY,
    status: 'active',
    language: 'en',
    responseCount: 0,
    targetParticipantCount: 20,
    createdAt: '2026-09-10T02:06:08.994263+00:00',
    ...over,
  }
}

function detailOf(item: Microclimate): MicroclimateDetail {
  return {
    id: item.id,
    title: item.title,
    description: null,
    companyId: COMPANY,
    createdBy: 'u-ana',
    status: item.status,
    responseCount: item.responseCount,
    targetParticipantCount: item.targetParticipantCount,
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
}

function renderAs(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u-ana', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/microclimates/analytics']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/microclimates/analytics" element={<MicroclimateAnalyticsNextPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function rowOf(title: string): HTMLElement {
  return screen.getByRole('link', { name: title }).closest('tr') as HTMLElement
}

describe('MicroclimateAnalyticsNextPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'es')
    vi.mocked(listMicroclimates).mockReset().mockResolvedValue([session({})])
    vi.mocked(getMicroclimate)
      .mockReset()
      .mockImplementation(async (_base, id) => detailOf(session({ id })))
    vi.mocked(getLiveResults).mockReset()
  })

  afterEach(() => {
    cleanup()
    clearToken()
    clearCompanyNameCache()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('shows the tenant’s pulse as the board does: its count under the floor, its figures hatched, its words never read', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    expect(await screen.findByText(copy.underFloor.replace('{floor}', '5'))).toBeTruthy()
    const row = rowOf('Pulso semanal — ¿cómo fue la semana?')
    expect(within(row).getByText(copy.protectedOne)).toBeTruthy()
    expect(within(row).getByText(copy.protectedMany)).toBeTruthy()
    expect(await within(row).findByText('2 preguntas · anónimo')).toBeTruthy()
    expect(screen.getByText(copy.pulseOne.replace('{floor}', '5'))).toBeTruthy()
    // A protected session's words are not even fetched.
    expect(getLiveResults).not.toHaveBeenCalled()
  })

  it('draws each row’s Resultados at the canvas’s 34px', async () => {
    renderAs({ role: 'company_admin', companyId: COMPANY })
    const row = await waitFor(() => rowOf('Pulso semanal — ¿cómo fue la semana?'))
    expect(within(row).getByRole('link', { name: es.microclimates.results }).className.split(' ')).toContain('h-control-canvas')
  })

  it('keeps the sessions table the positioning context of its sr-only header, so nothing escapes the scroll container', async () => {
    // Measured with the shot harness at 1024 before this: the sr-only "Acciones" span sat at
    // right=1051 outside the Table primitive's clip. happy-dom has no layout, so the guard
    // pins the cause: the table is positioned, and the header's text is inside it.
    renderAs({ role: 'company_admin', companyId: COMPANY })
    const table = (await screen.findByRole('heading', { name: copy.sessionsTitle })).closest('section')!.querySelector('table')!
    expect(table.className.split(/\s+/)).toContain('relative')
    expect(within(table).getByText(copy.colActions).className).toContain('sr-only')
  })

  it('at the floor counts the words a session may show — after both floors — and still prints no pulse figure', async () => {
    const open = session({ id: 'm2', title: 'Pulso de agosto', status: 'closed', responseCount: 6, createdAt: '2026-08-20T00:00:00Z' })
    vi.mocked(listMicroclimates).mockResolvedValue([session({}), open])
    vi.mocked(getLiveResults).mockResolvedValue({
      sentimentScore: 0,
      engagementLevel: 'low',
      responseCount: 6,
      targetParticipantCount: 20,
      wordCloud: [
        { text: 'carga', value: 4, language: 'es' },
        { text: 'apoyo', value: 2, language: 'es' },
        { text: 'visa', value: 1, language: 'es' },
      ],
    })
    renderAs({ role: 'company_admin', companyId: COMPANY })
    const row = await waitFor(() => rowOf('Pulso de agosto'))
    expect(await within(row).findByText('2 palabras')).toBeTruthy()
    expect(within(row).getByText(copy.noFigure)).toBeTruthy()
    expect(within(row).getByText('30 %')).toBeTruthy()
    expect(vi.mocked(getLiveResults).mock.calls.map((call) => call[1])).toEqual(['m2'])
    // The newest session is first, as the board's "la más reciente primero" says.
    const links = screen.getAllByRole('link').filter((link) => link.closest('tbody')).map((link) => link.textContent)
    expect(links[0]).toBe('Pulso semanal — ¿cómo fue la semana?')
  })

  it('asks a super administrator with no company chosen to choose one before anything is read', async () => {
    renderAs({ role: 'super_admin' })
    expect(await screen.findByText(es.companyContext.chooseACompany)).toBeTruthy()
    expect(listMicroclimates).not.toHaveBeenCalled()
  })

  it('reads the chosen company’s sessions for a super administrator', async () => {
    window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, COMPANY)
    renderAs({ role: 'super_admin' })
    await screen.findByRole('heading', { name: copy.sessionsTitle })
    expect(vi.mocked(listMicroclimates).mock.calls[0]?.[1]).toBe(COMPANY)
  })

  it('refuses a leader before any request is sent', async () => {
    renderAs({ role: 'leader', companyId: COMPANY })
    expect(await screen.findByText(es.microclimates.next.noAccessTitle)).toBeTruthy()
    expect(listMicroclimates).not.toHaveBeenCalled()
  })
})
