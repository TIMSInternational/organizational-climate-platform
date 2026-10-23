import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SurveyRosterPanel from './SurveyRosterPanel'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import { downloadBlobFile } from '../../../../lib/downloadBlobFile'
import es from '../../../../i18n/es.json'
import type { SurveyParticipationView } from '../../api/surveys'
import { surveyRosterCsvFileName } from './rosterExport'

// happy-dom has no download manager and no `URL.createObjectURL`; the assertion is on the
// (name, blob) pair the panel hands over, as `ReportsListPage.test.tsx` does it.
vi.mock('../../../../lib/downloadBlobFile', () => ({ downloadBlobFile: vi.fn() }))

const T = es.surveys.next.roster
const COMPANY = '11111111-1111-1111-1111-111111111111'
const SURVEY = '22222222-2222-2222-2222-222222222222'
const CSV = '﻿"Nombre","Correo","Rol","Usuario","Estado","Última actividad"\r\n'

function view(): SurveyParticipationView {
  return {
    surveyId: SURVEY,
    tracksCompletionOnly: false,
    collectsParticipantIdentity: false,
    answeredCount: 0,
    pendingCount: 1,
    answered: [],
    pending: [],
    startedCount: 0,
    notStartedCount: 1,
    roster: [
      {
        userId: 'ana',
        name: 'Ana Lucía Mora',
        email: 'ana@esph.test',
        username: 'esph-ana',
        role: 'employee',
        status: 'not_started',
        lastActivityOn: null,
        demographics: [],
      },
    ],
    tracksIndividuals: true,
    credentialMode: 'shared',
    surveyTitleEs: 'Clima Organizacional ESPH 2026',
    surveyTitleEn: 'Climate ESPH 2026',
  }
}

function renderPanel() {
  return render(
    <TranslationProvider>
      <SurveyRosterPanel state={{ status: 'ready', view: view() }} />
    </TranslationProvider>,
  )
}

/**
 * G20: the roster as a file. The server writes it (`SurveyRosterCsv.cs`); the panel's job is to
 * ask for it with the bearer header and save it under a name an administrator can find.
 */
describe('SurveyRosterPanel — Descargar estado', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken(tokenFor({ role: 'company_admin', companyId: COMPANY }))
    vi.mocked(downloadBlobFile).mockClear()
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('fetches the export with the bearer header and saves it under the survey title and the day', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(new Blob([CSV]), { status: 200, headers: { 'Content-Type': 'text/csv' } })),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: T.download }))

    await waitFor(() => expect(vi.mocked(downloadBlobFile)).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls.at(-1)!
    expect(String(url)).toMatch(new RegExp(`/surveys/${SURVEY}/participation/export$`))
    // A fetch with the header, never a link: an `<a href>` sends cookies, not the bearer.
    expect(new Headers(init?.headers).get('Authorization')).toMatch(/^Bearer /)

    const [fileName, blob] = vi.mocked(downloadBlobFile).mock.calls[0]!
    expect(fileName).toBe(surveyRosterCsvFileName('estado', 'Clima Organizacional ESPH 2026', new Date()))
    expect(fileName).toMatch(/^estado-clima-organizacional-esph-2026-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(await blob.text()).toBe(CSV)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says so, in Spanish, when the file cannot be produced, and saves nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } }),
        ),
      ),
    )
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: T.download }))

    expect((await screen.findByRole('alert')).textContent).toBe(T.downloadFailed)
    expect(vi.mocked(downloadBlobFile)).not.toHaveBeenCalled()
  })
})

describe('surveyRosterCsvFileName', () => {
  const day = new Date(2026, 9, 22, 9, 30)

  it('folds accents and punctuation the way the server names the file', () => {
    expect(surveyRosterCsvFileName('estado', 'Clima Laboral Contraloría Empresarial 2026', day)).toBe(
      'estado-clima-laboral-contraloria-empresarial-2026-2026-10-22.csv',
    )
  })

  it('caps a long title but never cuts the day off', () => {
    const name = surveyRosterCsvFileName('estado', 'Una encuesta con un título larguísimo que no cabe en ningún nombre de archivo', day)
    expect(name.endsWith('-2026-10-22.csv')).toBe(true)
    expect(name.length).toBeLessThanOrEqual(60 + '-2026-10-22.csv'.length)
    expect(name).not.toMatch(/--/)
  })
})
