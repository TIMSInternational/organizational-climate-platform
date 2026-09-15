import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import MySurveysNextPage from './MySurveysNextPage'
import { TranslationProvider } from '../../../../i18n'
import { CATALOGUES, LOCALE_STORAGE_KEY } from '../../../../i18n/locale'
import { createTranslator } from '../../../../i18n/translate'
import { CompanyContextProvider } from '../../../../company-context'
import { COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { setToken, clearToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import type { MySurveyListItem } from '../../api/surveys'
import type { EmployeeDashboard } from '../../../dashboard/api/dashboard'

/**
 * `/surveys/my`, against the payload shapes the local API returned for Grupo Meridiano
 * (carlos.mata, employee, Ingeniería).
 *
 * The guarantees the deleted `MySurveysPage.test.tsx` held are **moved** here rather than
 * copied: nothing mounts that component any more, so a copy of them there would keep
 * reporting as held against code no route renders.
 *
 * Copy is read from the catalogue the page reads, never retyped: a literal in a test is a
 * second copy of the catalogue that agrees with itself.
 */
const es = createTranslator(CATALOGUES.es)

const DAY = 86_400_000
const COMPANY = '16c97c29-07f8-4522-86fc-e6cc56298829'

/** An ISO instant exactly `days` whole days from now — negative for the past. */
function inDays(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString()
}

function item(overrides: Partial<MySurveyListItem> = {}): MySurveyListItem {
  return {
    id: '4c9c8c8c-03e1-4033-8224-8c80b242c558',
    title: 'Encuesta de Clima Q4 (abierta)',
    description: 'Seis preguntas sobre cómo se ha sentido el trimestre',
    type: 'periodic',
    startDate: inDays(-20),
    endDate: inDays(30),
    questionCount: 6,
    anonymous: true,
    timeLimitMinutes: null,
    ...overrides,
  }
}

function dashboard(overrides: Partial<EmployeeDashboard> = {}): EmployeeDashboard {
  return {
    name: 'Carlos Mata',
    companyId: COMPANY,
    departmentId: '5bfdb04e-8847-4baa-89c8-d4411654a129',
    departmentName: 'Ingeniería',
    pendingSurveyCount: 1,
    completedSurveyCount: 0,
    unreadNotificationCount: 0,
    nextDeadline: inDays(30),
    pendingSurveys: [],
    ...overrides,
  }
}

interface Serving {
  surveys?: MySurveyListItem[]
  /** `'fail'` answers 500 — the page's error band. */
  list?: 'fail'
  /** `'fail'` answers 500 — the eyebrow's supplementary read. */
  home?: EmployeeDashboard | 'fail'
}

function serves({ surveys = [item()], list, home = dashboard() }: Serving = {}) {
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/dashboard/employee')) {
      return Promise.resolve(
        home === 'fail'
          ? new Response(JSON.stringify({ message: 'boom' }), { status: 500 })
          : new Response(JSON.stringify(home), { status: 200 }),
      )
    }
    if (url.includes('/surveys/my')) {
      return Promise.resolve(
        list === 'fail'
          ? new Response(JSON.stringify({ message: 'la lista no respondió' }), { status: 500 })
          : new Response(JSON.stringify({ surveys }), { status: 200 }),
      )
    }
    return Promise.resolve(new Response('null', { status: 404 }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage(claims: Record<string, unknown> = { role: 'employee', companyId: COMPANY }) {
  setToken(tokenFor(claims))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/my']}>
        <CompanyContextProvider>
          <MySurveysNextPage />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/** The row element around a survey's title. */
function rowAround(title: string): HTMLElement {
  const found = screen.getByText(title).closest('[data-slot="my-survey-row"]')
  if (!found) throw new Error(`no survey row around "${title}"`)
  return found as HTMLElement
}

function chipIn(element: HTMLElement): HTMLElement {
  const chip = element.querySelector('[data-slot="chip"]')
  if (!chip) throw new Error('no chip in row')
  return chip as HTMLElement
}

beforeEach(() => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
})

afterEach(() => {
  cleanup()
  clearToken()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MySurveysNextPage', () => {
  it('loads for a plain employee, hitting the per-user endpoint and no admin one', async () => {
    const fetchMock = serves()
    renderPage()

    expect(await screen.findByText('Encuesta de Clima Q4 (abierta)')).toBeTruthy()
    const listUrl = fetchMock.mock.calls.map((call) => String(call[0])).find((url) => url.includes('/surveys/my'))
    expect(listUrl).toBeTruthy()
    // No company or status scoping is sent: the server derives both from the caller's own
    // user row, which is what makes this loadable without an admin role.
    expect(listUrl).not.toContain('companyId')
  })

  it('reads a row out as questions, an estimated duration and a closing day', async () => {
    serves({ surveys: [item({ questionCount: 6 })] })
    renderPage()

    // Six questions is four minutes at `respondEstimate`'s ratio — the same figure Home
    // prints for the same survey, from the same module.
    const meta = await screen.findByText(/^6 preguntas · unos 4 minutos · cierra el .+$/)
    expect(meta).toBeTruthy()
  })

  it('says “menos de un minuto” for a one-question pulse rather than a number', async () => {
    serves({ surveys: [item({ questionCount: 1 })] })
    renderPage()

    expect(await screen.findByText(/^1 pregunta · menos de un minuto · cierra el .+$/)).toBeTruthy()
  })

  it('chips the days left, in whole calendar days, with singular and today spelled out', async () => {
    serves({
      surveys: [
        item({ id: 'a', title: 'Seis días', endDate: inDays(6) }),
        item({ id: 'b', title: 'Un día', endDate: inDays(1) }),
        item({ id: 'c', title: 'Último día', endDate: inDays(0) }),
      ],
    })
    renderPage()

    expect(await screen.findByText(es('employee.daysLeftChip', { days: 6 }))).toBeTruthy()
    expect(screen.getByText(es('employee.oneDayLeftChip'))).toBeTruthy()
    // Still open on its closing day — it has not closed until the day is past.
    expect(screen.getByText(es('employee.taskClosesToday'))).toBeTruthy()
    expect(screen.queryByText(es('employee.daysLeftChip', { days: 0 }))).toBeNull()
  })

  it('lights up only the rows closing soon, and tones their chip to match', async () => {
    serves({
      surveys: [
        item({ id: 'a', title: 'Cierra pronto', endDate: inDays(6) }),
        item({ id: 'b', title: 'Queda tiempo', endDate: inDays(40) }),
      ],
    })
    renderPage()

    await screen.findByText('Cierra pronto')
    const urgent = rowAround('Cierra pronto')
    const relaxed = rowAround('Queda tiempo')

    expect(urgent.className).toContain('bg-accent-blue-soft')
    expect(chipIn(urgent).className).toContain('chip-warning')

    expect(relaxed.className).not.toContain('bg-accent-blue-soft')
    expect(chipIn(relaxed).className).toContain('chip-neutral')
  })

  it('offers one action per open row, pointed at the respond route for that survey', async () => {
    serves({ surveys: [item({ id: 'abc-123' })] })
    renderPage()

    const answer = await screen.findByRole('link', { name: es('dashboard.respondNow') })
    expect(answer.getAttribute('href')).toBe('/surveys/abc-123/respond')
  })

  /**
   * The artboard draws one row and one red "Responder", and the canvas's rule is at most one
   * primary per screen. Home already splits the same way — the survey it leads with gets the
   * primary, the rest a quieter way in — so the head of the queue carries it here too.
   */
  it('puts the one red button on the head of the queue and gives the rest a quieter way in', async () => {
    serves({
      surveys: [
        item({ id: 'a', title: 'Primera', endDate: inDays(2) }),
        item({ id: 'b', title: 'Segunda', endDate: inDays(20) }),
        item({ id: 'c', title: 'Tercera', endDate: inDays(40) }),
      ],
    })
    renderPage()

    await screen.findByText('Primera')
    const ways = screen.getAllByRole('link', { name: es('dashboard.respondNow') })
    expect(ways.map((link) => link.getAttribute('href'))).toEqual([
      '/surveys/a/respond',
      '/surveys/b/respond',
      '/surveys/c/respond',
    ])
    expect(ways.filter((link) => link.className.includes('bg-accent-blue-fill'))).toHaveLength(1)
    expect(ways[0].className).toContain('bg-accent-blue-fill')
  })

  it('counts the list beside the heading and says it is the whole of it, not Home’s five', async () => {
    serves({
      surveys: [
        item({ id: 'a', title: 'Una' }),
        item({ id: 'b', title: 'Dos' }),
        item({ id: 'c', title: 'Tres' }),
      ],
    })
    renderPage()

    const heading = await screen.findByRole('heading', { name: `${es('employee.next.toAnswerHeading')} 3` })
    expect(heading).toBeTruthy()
    expect(screen.getByText(es('employee.next.toAnswerSorted'))).toBeTruthy()
    expect(screen.getByText(es('employee.next.wholeListNote'))).toBeTruthy()
  })

  it('renders no Closed group for the only payload the API can currently serve', async () => {
    // `SurveyQueries.AssignedTo` hard-filters `Status == Active`, so every row that arrives
    // here is open. An empty heading would assert something untrue about the reader.
    serves()
    renderPage()

    await screen.findByText('Encuesta de Clima Q4 (abierta)')
    expect(screen.queryByRole('heading', { name: es('employee.mySurveysClosedHeading') })).toBeNull()
    expect(screen.queryByText(es('employee.notRecordedChip'))).toBeNull()
  })

  it('groups a row whose window has ended under Cerradas, and never claims the reader answered it', async () => {
    serves({
      surveys: [
        item({ id: 'open', title: 'Encuesta de Clima Q4 (abierta)', endDate: inDays(6) }),
        item({ id: 'past', title: 'Encuesta de Clima Q3', endDate: inDays(-8) }),
      ],
    })
    renderPage()

    expect(await screen.findByRole('heading', { name: es('employee.mySurveysClosedHeading') })).toBeTruthy()

    const past = rowAround('Encuesta de Clima Q3')
    expect(past.getAttribute('data-open')).toBe('false')
    // Never a tick: `SurveyResponse.UserId` is NULL on an anonymous response, so the
    // product genuinely does not know whether this reader answered.
    expect(chipIn(past).textContent).toBe(es('employee.notRecordedChip'))
    expect(past.querySelector('a')?.getAttribute('href')).toBe('/dashboard')
    // The open row is still above, in its own group, and still answerable.
    expect(rowAround('Encuesta de Clima Q4 (abierta)').getAttribute('data-open')).toBe('true')
  })

  /**
   * The artboard's second section is a receipt — every survey answered, with the date. No
   * endpoint carries either fact (`SurveyQueries.AssignedTo` drops a survey the moment it is
   * completed), so the page draws the artboard's own explanation of the absence instead, and
   * must never grow a table that implies the record exists.
   */
  it('keeps the two reasons this list holds no receipt, and offers no receipt', async () => {
    serves()
    renderPage()

    const card = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-slot="my-surveys-not-kept"]')
      if (!node) throw new Error('no card yet')
      return node
    })
    expect(within(card).getByText(es('employee.next.notKeptAnonymousTitle'))).toBeTruthy()
    expect(within(card).getByText(es('employee.next.notKeptAnonymousBody'))).toBeTruthy()
    expect(within(card).getByText(es('employee.next.notKeptAnswersTitle'))).toBeTruthy()
    expect(within(card).getByText(es('employee.next.notKeptAnswersBody'))).toBeTruthy()
    // No "Ya respondidas" group, and no column of dates a reader could read as one.
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('names the department and the role in the eyebrow', async () => {
    serves()
    renderPage()

    await waitFor(() =>
      expect(document.querySelector('[data-slot="page-eyebrow"]')?.textContent).toBe(
        `Ingeniería · ${es('users.employee')}`,
      ),
    )
  })

  it('names the role alone when the department could not be read, rather than guessing one', async () => {
    serves({ home: 'fail' })
    renderPage()

    await screen.findByText('Encuesta de Clima Q4 (abierta)')
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/dashboard/employee'))).toBe(true),
    )
    expect(document.querySelector('[data-slot="page-eyebrow"]')?.textContent).toBe(es('users.employee'))
  })

  it('renders the centred employee empty state rather than an admin “adjust your filters”', async () => {
    // This page has no filters, so the admin listing's empty copy would be nonsense here.
    serves({ surveys: [] })
    renderPage()

    const title = await screen.findByText(es('employee.mySurveysEmptyTitle'))
    expect(screen.getByText(es('employee.mySurveysEmptyBody'))).toBeTruthy()
    // `fill` — the centred block, not a stub stranded at the top of the card.
    expect(title.closest('[data-slot="error-state"]')?.getAttribute('data-fill')).toBe('true')
  })

  it('offers a retry, and the server’s own words, when the list fails', async () => {
    serves({ list: 'fail' })
    renderPage()

    expect(await screen.findByText('la lista no respondió')).toBeTruthy()
    expect(screen.getByRole('button', { name: es('common.retry') })).toBeTruthy()
  })
})

describe('MySurveysNextPage — an account that belongs to no company', () => {
  it('tells a super administrator why no survey reaches them, and asks the server for nothing', async () => {
    const fetchMock = serves()
    renderPage({ role: 'super_admin', companyId: '' })

    expect(await screen.findByText(es('employee.next.noCompanyTitle'))).toBeTruthy()
    expect(screen.getByText(es('employee.next.noCompanyBodySuperAdmin'))).toBeTruthy()
    expect(document.querySelector('[data-slot="page-eyebrow"]')?.textContent).toBe(
      es('employee.next.noCompanyEyebrow'),
    )
    // The old page promised "Todavía no le han enviado nada" — a delivery that can never
    // arrive for an account that belongs to no tenant.
    expect(screen.queryByText(es('employee.mySurveysEmptyTitle'))).toBeNull()
    // The shape is decided by the token, so nothing is fetched at all.
    expect(fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/surveys/my'))).toEqual([])
  })

  it('keeps a super administrator’s two ways out, both at real routes', async () => {
    serves()
    renderPage({ role: 'super_admin', companyId: '' })

    const all = await screen.findByRole('link', { name: es('navigation.surveys') })
    expect(all.getAttribute('href')).toBe('/surveys')
    expect(screen.getByRole('link', { name: es('navigation.dashboard') }).getAttribute('href')).toBe('/dashboard')
  })

  it('does not send a company-less leader to an administrator’s listing', async () => {
    serves()
    renderPage({ role: 'leader', companyId: '' })

    expect(await screen.findByText(es('employee.next.noCompanyTitle'))).toBeTruthy()
    // A different sentence: this reader is waiting on an assignment, not standing outside
    // every tenant by design.
    expect(screen.getByText(es('employee.next.noCompanyBody'))).toBeTruthy()
    expect(screen.queryByText(es('employee.next.noCompanyBodySuperAdmin'))).toBeNull()
    // `/surveys` is an administrator's listing and this role's nav does not offer it.
    expect(screen.queryByRole('link', { name: es('navigation.surveys') })).toBeNull()
    expect(screen.getByRole('link', { name: es('navigation.dashboard') })).toBeTruthy()
  })

  it('still stands aside for a super administrator who has selected a tenant to administer', () => {
    // The selection says which company they are *administering*; their own row still names
    // none, so `/surveys/my` would be empty whatever they chose.
    window.localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, COMPANY)
    serves()
    renderPage({ role: 'super_admin', companyId: '' })

    expect(screen.getByText(es('employee.next.noCompanyTitle'))).toBeTruthy()
  })
})
