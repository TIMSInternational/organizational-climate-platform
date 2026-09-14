import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import EmployeeHomeView from './EmployeeHomeView'
import { TranslationProvider } from '../../../../i18n'
import { CATALOGUES, LOCALE_STORAGE_KEY } from '../../../../i18n/locale'
import { createTranslator } from '../../../../i18n/translate'
import { CompanyContextProvider } from '../../../../company-context'
import { setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import type { DashboardPendingSurvey, EmployeeDashboard, EmployeeLastOutcome } from '../../api/dashboard'

/**
 * The redesigned employee Home, rendered against the payload shapes the local API returned
 * for Grupo Meridiano (carlos.mata, employee, Ingeniería — 11 Sep 2026).
 *
 * Copy is read from the Spanish catalogue the page reads, never retyped here: a literal in
 * a test is a second copy of the catalogue that agrees with itself.
 */
const es = createTranslator(CATALOGUES.es)

function survey(overrides: Partial<DashboardPendingSurvey> = {}): DashboardPendingSurvey {
  return {
    id: '4c9c8c8c-03e1-4033-8224-8c80b242c558',
    title: 'Encuesta de Clima Q4 (abierta)',
    type: 'periodic',
    startDate: '2026-09-03T02:03:39.148+00:00',
    endDate: '2026-10-10T02:03:39.148+00:00',
    questionCount: 6,
    anonymous: true,
    ...overrides,
  }
}

function home(overrides: Partial<EmployeeDashboard> = {}): EmployeeDashboard {
  return {
    name: 'Carlos Mata',
    companyId: '16c97c29-07f8-4522-86fc-e6cc56298829',
    departmentId: '5bfdb04e-8847-4baa-89c8-d4411654a129',
    departmentName: 'Ingeniería',
    pendingSurveyCount: 1,
    // Deliberately a number no other part of this page prints, so its absence is checkable.
    completedSurveyCount: 37,
    unreadNotificationCount: 0,
    nextDeadline: '2026-10-10T02:03:39.148+00:00',
    pendingSurveys: [survey()],
    ...overrides,
  }
}

function outcome(overrides: Partial<EmployeeLastOutcome> = {}): EmployeeLastOutcome {
  return {
    surveyId: '38b2002f-66da-468d-b136-ec112ba3204b',
    surveyTitle: 'Encuesta de Clima Q3',
    closedOn: '2026-08-06T02:05:22.922+00:00',
    responseCount: 24,
    departmentCount: 5,
    protectedDepartmentCount: 1,
    minimumGroupSize: 5,
    plansOpenedSince: [
      { departmentName: 'Personas', createdAt: '2026-09-10T02:05:50.263923+00:00' },
      { departmentName: 'Operaciones', createdAt: '2026-09-10T02:05:50.280646+00:00' },
      { departmentName: 'Ingeniería', createdAt: '2026-09-10T02:05:50.287727+00:00' },
      { departmentName: null, createdAt: '2026-09-10T02:05:50.294635+00:00' },
    ],
    openPlanCount: 4,
    ...overrides,
  }
}

interface Serving {
  dashboard?: unknown
  lastOutcome?: unknown
  /** The lead survey's respond view; `'fail'` answers 500. */
  respond?: { allowPartialResponses: boolean } | 'fail'
}

/** Answers `fetch` by URL, with a fresh `Response` per call (a body is read once). */
function serves({ dashboard = home(), lastOutcome = outcome(), respond = { allowPartialResponses: true } }: Serving = {}) {
  vi.mocked(fetch).mockImplementation((input) => {
    const url = String(input)
    if (url.includes('/dashboard/employee/last-outcome')) {
      return Promise.resolve(new Response(JSON.stringify(lastOutcome), { status: 200 }))
    }
    if (url.includes('/dashboard/employee')) {
      return Promise.resolve(new Response(JSON.stringify(dashboard), { status: 200 }))
    }
    if (url.includes('/respond')) {
      return Promise.resolve(
        respond === 'fail'
          ? new Response(JSON.stringify({ message: 'boom' }), { status: 500 })
          : new Response(JSON.stringify(respond), { status: 200 }),
      )
    }
    return Promise.resolve(new Response('null', { status: 404 }))
  })
}

function renderHome(role = 'employee') {
  setToken(tokenFor({ role, companyId: '16c97c29-07f8-4522-86fc-e6cc56298829' }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <CompanyContextProvider>
          <EmployeeHomeView />
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function respondHrefs(): string[] {
  return screen
    .queryAllByRole('link')
    .map((link) => link.getAttribute('href') ?? '')
    .filter((href) => href.endsWith('/respond'))
}

describe('EmployeeHomeView', () => {
  // The countdown is the reader's calendar days (`compose.ts`), so the zone is pinned to
  // the tenant's: CI runs in UTC, where the canvas's evening is already the 11th.
  const originalTz = process.env.TZ
  beforeEach(() => {
    process.env.TZ = 'America/Costa_Rica'
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    vi.stubGlobal('fetch', vi.fn())
    // The canvas's evening: 21:50 on 10 Sep in Costa Rica, 03:50 UTC on the 11th.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-09-11T03:50:00.000Z'))
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    process.env.TZ = originalTz
  })

  it('leads with the survey owed, and its one way in is the respond route', async () => {
    serves()
    renderHome()

    const lead = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-slot="home-lead"]')
      if (!node) throw new Error('no lead card yet')
      return node
    })
    expect(within(lead).getByRole('heading', { name: 'Encuesta de Clima Q4 (abierta)' })).toBeTruthy()
    const start = within(lead).getByRole('link', { name: es('employee.startAnswering') })
    expect(start.getAttribute('href')).toBe('/surveys/4c9c8c8c-03e1-4033-8224-8c80b242c558/respond')
  })

  it('reads the canvas’s countdown and three readings from the payload, not from type', async () => {
    serves()
    renderHome()

    const lead = await screen.findByText(
      [es('employee.taskClosesInDays', { days: 30 }), es('employee.next.closesOnDate', { date: '10 de octubre' })].join(' · '),
    )
    expect(lead).toBeTruthy()
    // Six questions, about four minutes — computed from the count, never typed.
    expect(screen.getByText('6')).toBeTruthy()
    expect(screen.getByText(es('employee.taskMinutes', { minutes: 4 }))).toBeTruthy()
    expect(screen.getByText('10 oct')).toBeTruthy()
  })

  /**
   * At 390px the three tiles are ~70px inside, and "unos 4 min" does not fit on one line.
   * An ellipsised "unos 4…" is a different reading, so a reading wraps; it never truncates.
   * Found in the 390 screenshot, where DURACIÓN read "unos 4…".
   */
  it('wraps a reading rather than cutting it short', async () => {
    serves()
    renderHome()

    const lead = await waitFor(() => {
      const found = document.querySelector('[data-slot="home-lead"]')
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    const values = [...lead.querySelectorAll('dd')]
    expect(values).toHaveLength(3)
    for (const value of values) {
      expect(value.className.split(/\s+/)).toContain('break-words')
      expect(value.className.split(/\s+/)).not.toContain('truncate')
    }
  })

  /**
   * At 390px equal thirds are ~70px inside and "unos 4 min" is ~84px of mono, so it broke as
   * "unos 4 / min" (home-390-light.png, fix round 1; and in the 1024 two-column card). A tile
   * takes an equal third where a third holds its reading and is never narrower than its
   * reading; one that does not fit moves to the next line. A reading's number is held to its
   * unit besides.
   */
  it('holds each reading’s number to its unit, and never draws a tile narrower than its reading', async () => {
    serves()
    renderHome()

    const lead = await waitFor(() => {
      const found = document.querySelector('[data-slot="home-lead"]')
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    expect([...lead.querySelectorAll('dd')].map((value) => value.textContent)).toEqual([
      '6',
      es('employee.taskMinutes', { minutes: 4 }).replace(' min', '\u00a0min'),
      '10\u00a0oct',
    ])
    const list = lead.querySelector('dl') as HTMLElement
    const classes = list.className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['flex', 'flex-wrap']))
    // Fixed thirds are what broke it: no grid track decides a tile's width.
    expect(classes.some((name) => name.includes('grid'))).toBe(false)
    for (const tile of list.children) {
      const tileClasses = tile.className.split(/\s+/)
      // Equal shares from a zero basis, floored at the reading: with `min-w-0` a tile shrank
      // and "10 oct" broke as "10 oc / t" at 390px (fix round 2's first shot, read).
      expect(tileClasses).toEqual(expect.arrayContaining(['flex-1', 'min-w-max']))
      expect(tileClasses).not.toContain('min-w-0')
    }
  })

  it('makes the anonymity promise beside an anonymous survey, in the respond page’s words', async () => {
    serves()
    renderHome()

    const notice = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-slot="anonymity-notice"]')
      if (!node) throw new Error('no notice yet')
      return node
    })
    expect(notice.getAttribute('data-anonymous')).toBe('true')
    expect(within(notice).getByText(es('surveyRespond.anonymousChip'))).toBeTruthy()
    expect(within(notice).getByText(es('surveyRespond.anonymousBody'))).toBeTruthy()
  })

  it('makes no promise at all beside a survey that records who answered — and never says "not anonymous"', async () => {
    serves({ dashboard: home({ pendingSurveys: [survey({ anonymous: false })] }) })
    renderHome()

    await screen.findByRole('link', { name: es('employee.startAnswering') })
    expect(document.querySelector('[data-slot="anonymity-notice"]')).toBeNull()
    expect(screen.queryByText(es('surveyRespond.anonymousChip'))).toBeNull()
    expect(screen.queryByText(es('surveyRespond.identifiedChip'))).toBeNull()
  })

  it('never prints how many surveys this person completed, which an anonymous survey cannot know', async () => {
    serves()
    renderHome()

    await screen.findByRole('link', { name: es('employee.startAnswering') })
    expect(document.body.textContent).not.toContain('37')
  })

  it('says the survey can be finished later only when its own setting allows it', async () => {
    serves({ respond: { allowPartialResponses: true } })
    renderHome()
    expect(await screen.findByText(es('employee.next.canSaveLater'))).toBeTruthy()
  })

  it('says nothing about finishing later when the survey forbids it', async () => {
    serves({ respond: { allowPartialResponses: false } })
    renderHome()
    await screen.findByRole('link', { name: es('employee.startAnswering') })
    // The respond view has answered before this is asserted.
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/respond'))).toBe(true),
    )
    expect(screen.queryByText(es('employee.next.canSaveLater'))).toBeNull()
  })

  it('says nothing about finishing later when the setting could not be read', async () => {
    serves({ respond: 'fail' })
    renderHome()
    await screen.findByRole('link', { name: es('employee.startAnswering') })
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/respond'))).toBe(true),
    )
    expect(screen.queryByText(es('employee.next.canSaveLater'))).toBeNull()
  })

  it('offers every other open survey as a quieter row with its own way in', async () => {
    serves({
      dashboard: home({
        pendingSurveyCount: 2,
        pendingSurveys: [
          survey(),
          survey({ id: '801a81a4-3551-4f08-96f4-d465e05b1605', title: 'Encuesta de Clima Q4 (abierta) (Copia)' }),
        ],
      }),
    })
    renderHome()

    const row = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-slot="home-also-open"]')
      if (!node) throw new Error('no row yet')
      return node
    })
    expect(within(row).getByText('Encuesta de Clima Q4 (abierta) (Copia)')).toBeTruthy()
    expect(within(row).getByText(es('employee.surveyMeta', { questions: 6, minutes: 4, date: '10 oct' }))).toBeTruthy()
    expect(respondHrefs()).toEqual([
      '/surveys/4c9c8c8c-03e1-4033-8224-8c80b242c558/respond',
      '/surveys/801a81a4-3551-4f08-96f4-d465e05b1605/respond',
    ])
    // The canvas's pattern — the card's survey, then what else is open — with the real count.
    expect(document.querySelector('[data-slot="home-to-answer-meta"]')?.textContent).toBe(
      es('employee.next.toAnswerMetaAndOneMore'),
    )
    expect(screen.getByText(es('employee.next.homeDescriptionMany', { count: 2 }))).toBeTruthy()
  })

  /**
   * "Hay una encuesta abierta para usted" is a count. With two open it sat over "2 encuestas
   * abiertas" — one short of the section under it (home-390-light.png, fix round 1). Both
   * sentences are counted from `pendingSurveyCount`.
   */
  it('counts the open surveys from the payload, under the greeting and in the section meta', async () => {
    serves({
      dashboard: home({
        pendingSurveyCount: 3,
        pendingSurveys: [
          survey(),
          survey({ id: '801a81a4-3551-4f08-96f4-d465e05b1605', title: 'Encuesta de Clima Q4 (abierta) (Copia)' }),
          survey({ id: 'a7c4f1de-2b8e-4a55-9d1e-3f0b6c2d9e11', title: 'Pulso de bienvenida' }),
        ],
      }),
    })
    renderHome()

    expect(await screen.findByText(es('employee.next.homeDescriptionMany', { count: 3 }))).toBeTruthy()
    expect(screen.queryByText(es('employee.homeDescription'))).toBeNull()
    expect(document.querySelector('[data-slot="home-to-answer-meta"]')?.textContent).toBe(
      es('employee.next.toAnswerMetaAndMore', { count: 2 }),
    )
  })

  it('counts the rest from the count, not from the page of the list the payload carries', async () => {
    // `SurveyRowLimit` = 5: the list is a page of the open surveys, and the count is the truth.
    const page = Array.from({ length: 5 }, (_, index) =>
      survey({ id: `00000000-0000-4000-8000-00000000000${index}`, title: `Encuesta ${index + 1}` }),
    )
    serves({ dashboard: home({ pendingSurveyCount: 7, pendingSurveys: page }) })
    renderHome()

    expect(await screen.findByText(es('employee.next.homeDescriptionMany', { count: 7 }))).toBeTruthy()
    expect(document.querySelector('[data-slot="home-to-answer-meta"]')?.textContent).toBe(
      es('employee.next.toAnswerMetaAndMore', { count: 6 }),
    )
  })

  it('keeps the one-survey sentences when one survey is open', async () => {
    serves()
    renderHome()

    expect(await screen.findByText(es('employee.homeDescription'))).toBeTruthy()
    expect(document.querySelector('[data-slot="home-to-answer-meta"]')?.textContent).toBe(
      es('employee.next.toAnswerMetaOne'),
    )
  })

  /**
   * Two measurements pull this row opposite ways. At 390px "Responder" dropped onto a line of
   * its own under the row's text (home-390-light.png, fix round 1), so round 2 took the wrap
   * away; then at 320px the title and its line were squeezed into a 117px column 207px tall,
   * a word or two a line (home-320-light.png, fix round 3). The row wraps, but only below the
   * text's 180px floor: beside it at 390 and wider, under it — at the right — at 375 and
   * narrower. happy-dom has no layout, so this pins the three classes that decide it; the
   * widths are measured in the lane's shots.
   */
  it('keeps each other survey’s way in beside its text while the text keeps 180px, and drops it under the text below that', async () => {
    serves({
      dashboard: home({
        pendingSurveyCount: 2,
        pendingSurveys: [
          survey(),
          survey({ id: '801a81a4-3551-4f08-96f4-d465e05b1605', title: 'Encuesta de Clima Q4 (abierta) (Copia)' }),
        ],
      }),
    })
    renderHome()

    const row = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-slot="home-also-open"]')
      if (!node) throw new Error('no row yet')
      return node
    })
    // Wraps, so a narrow phone does not squeeze the title to a word a line…
    expect(row.className.split(/\s+/)).toContain('flex-wrap')
    const [text, way] = [...row.children] as HTMLElement[]
    // …but only below the text's 180px floor. A zero basis (`flex-1`) never wraps; no basis at
    // all wraps whenever the title is long, at 390 too.
    expect(text.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-w-0', 'grow', 'basis-45']))
    expect(text.className.split(/\s+/)).not.toContain('flex-1')
    expect(way.tagName).toBe('A')
    // At the right of the row on either line.
    expect(way.className.split(/\s+/)).toEqual(expect.arrayContaining(['shrink-0', 'ml-auto']))
  })

  it('answers an empty queue in words naming the department, and offers no way into a survey', async () => {
    serves({ dashboard: home({ pendingSurveyCount: 0, pendingSurveys: [], nextDeadline: null }) })
    renderHome()

    expect(
      await screen.findByText(es('employee.emptyBodyInDepartment', { department: 'Ingeniería' })),
    ).toBeTruthy()
    expect(respondHrefs()).toEqual([])
    expect(screen.getByText(es('employee.homeDescriptionNothingDue'))).toBeTruthy()
  })

  it('tells what came of the last survey, naming no protected department and counting none of its answers', async () => {
    serves()
    renderHome()

    const card = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-slot="home-outcome"]')
      if (!node) throw new Error('no outcome card yet')
      return node
    })
    const closed = [
      es('employee.cameOfItClosedBody', { responses: 24, departments: 5 }),
      es('employee.cameOfItProtectedOne', { floor: 5 }),
    ].join(' ')
    expect(within(card).getByText(closed)).toBeTruthy()
    expect(within(card).getByText(es('employee.cameOfItPlansTitle', { count: 4 }))).toBeTruthy()
    expect(
      within(card).getByText(
        [
          es('employee.cameOfItPlansBody', { departments: 'Personas, Operaciones e Ingeniería' }),
          es('employee.next.plansStillOpen', { count: 4 }),
        ].join(' '),
      ),
    ).toBeTruthy()
    expect(within(card).getByText('6 ago')).toBeTruthy()
    expect(within(card).getByText('10 sept')).toBeTruthy()
  })

  it('draws no outcome card at all when nothing has closed', async () => {
    serves({ lastOutcome: null })
    renderHome()

    await screen.findByRole('link', { name: es('employee.startAnswering') })
    expect(document.querySelector('[data-slot="home-outcome"]')).toBeNull()
    expect(screen.queryByText(es('employee.cameOfItHeading'))).toBeNull()
  })

  it('names the department and the role in the eyebrow for an employee', async () => {
    serves()
    renderHome('employee')

    await screen.findByRole('link', { name: es('employee.startAnswering') })
    const eyebrow = document.querySelector('[data-slot="page-eyebrow"]')
    expect(eyebrow?.textContent).toBe(`Ingeniería · ${es('users.employee')}`)
  })

  it('names only the department for a role it does not know, rather than guessing one', async () => {
    serves()
    renderHome('auditor')

    await screen.findByRole('link', { name: es('employee.startAnswering') })
    const eyebrow = document.querySelector('[data-slot="page-eyebrow"]')
    expect(eyebrow?.textContent).toBe('Ingeniería')
  })

  it('greets the person by name in the heading, by their own clock', async () => {
    serves()
    renderHome()

    const hour = new Date().getHours()
    const key =
      hour < 12 ? 'employee.greetingMorning' : hour < 18 ? 'employee.greetingAfternoon' : 'employee.greetingEvening'
    expect(await screen.findByRole('heading', { level: 1, name: es(key, { name: 'Carlos Mata' }) })).toBeTruthy()
  })
})
