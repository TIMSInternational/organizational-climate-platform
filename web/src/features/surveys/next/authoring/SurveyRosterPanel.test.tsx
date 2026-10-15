import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SurveyRosterPanel from './SurveyRosterPanel'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import es from '../../../../i18n/es.json'
import type { SurveyParticipationView, SurveyRosterRow } from '../../api/surveys'

const T = es.surveys.next.roster
const COMPANY = '11111111-1111-1111-1111-111111111111'
const SURVEY = '22222222-2222-2222-2222-222222222222'

function row(over: Partial<SurveyRosterRow> & { userId: string; name: string }): SurveyRosterRow {
  return {
    email: `${over.userId}@esph.test`,
    username: `esph-${over.userId}`,
    role: 'employee',
    status: 'not_started',
    lastActivityOn: null,
    demographics: [],
    ...over,
  }
}

const MARTA = row({
  userId: 'marta',
  name: 'Marta Villalobos',
  status: 'completed',
  lastActivityOn: '2026-10-12',
  demographics: [
    { field: 'puesto', labelEs: 'Puesto', labelEn: 'Position', value: 'Gerente' },
    { field: 'antiguedad', labelEs: 'Antigüedad', labelEn: 'Tenure', value: 'Más de 10 años' },
  ],
})
const HUGO = row({ userId: 'hugo', name: 'Hugo Peralta', status: 'started', lastActivityOn: '2026-10-13' })
const ANA = row({ userId: 'ana', name: 'Ana Lucía Mora', status: 'not_started' })
const ADMIN = row({ userId: 'admin', name: 'Admin Rojas', username: null, role: 'company_admin' })

function view(over: Partial<SurveyParticipationView> = {}): SurveyParticipationView {
  const roster = over.roster ?? [ADMIN, ANA, HUGO, MARTA]
  return {
    surveyId: SURVEY,
    collectsParticipantIdentity: false,
    answeredCount: roster.filter((r) => r.status === 'completed').length,
    pendingCount: roster.filter((r) => r.status !== 'completed').length,
    answered: [],
    pending: [],
    startedCount: roster.filter((r) => r.status === 'started').length,
    notStartedCount: roster.filter((r) => r.status === 'not_started').length,
    roster,
    tracksIndividuals: true,
    ...over,
  }
}

type Sent = { url: string; body: unknown }

function fetchWith(participation: SurveyParticipationView, onPost?: (ids: string[]) => unknown) {
  const sent: Sent[] = []
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
      const body = JSON.parse(String(init?.body)) as { userIds: string[] }
      sent.push({ url, body })
      const outcomes = onPost
        ? onPost(body.userIds)
        : body.userIds.map((userId) => ({ userId, email: null, delivered: true, failureReason: null, code: null }))
      const list = outcomes as { delivered: boolean }[]
      return Promise.resolve(
        new Response(
          JSON.stringify({
            requested: body.userIds.length,
            sent: list.filter((o) => o.delivered).length,
            failed: list.filter((o) => !o.delivered).length,
            outcomes: list,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify(participation), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  })
  return { mock, sent }
}

/**
 * The panel takes the payload rather than fetching it: the page fetches once and hands it to
 * both panels that read it. `fetch` is still stubbed because the RESEND posts through it.
 */
function renderPanel(payload: SurveyParticipationView) {
  return render(
    <TranslationProvider>
      <SurveyRosterPanel state={{ status: 'ready', view: payload }} />
    </TranslationProvider>,
  )
}

/**
 * The screen an administrator watches all launch day: every invited person, how they sign in,
 * which of the THREE states they are in, and the demographics the import uploaded.
 */
describe('SurveyRosterPanel', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken(tokenFor({ role: 'company_admin', companyId: COMPANY }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('separates the person who stopped halfway from the person who never opened it', async () => {
    const payload = view()
    vi.stubGlobal('fetch', fetchWith(payload).mock)
    renderPanel(payload)

    expect(await screen.findByText('Marta Villalobos')).toBeTruthy()
    expect(within(rowOf('marta')).getByText(T.statusCompleted)).toBeTruthy()
    expect(within(rowOf('hugo')).getByText(T.statusStarted)).toBeTruthy()
    expect(within(rowOf('ana')).getByText(T.statusNotStarted)).toBeTruthy()

    // The counts an administrator reads off the filters, each from the payload's own field.
    expect(screen.getByRole('button', { name: new RegExp(`^${T.filterStarted}`) }).textContent).toContain('1')
    expect(screen.getByRole('button', { name: new RegExp(`^${T.filterNotStarted}`) }).textContent).toContain('2')
  })

  it('filters to just the people who started and did not finish', async () => {
    const payload = view()
    vi.stubGlobal('fetch', fetchWith(payload).mock)
    const user = userEvent.setup()
    renderPanel(payload)
    await screen.findByText('Marta Villalobos')

    await user.click(screen.getByRole('button', { name: new RegExp(`^${T.filterStarted}`) }))

    expect(screen.getByText('Hugo Peralta')).toBeTruthy()
    expect(screen.queryByText('Marta Villalobos')).toBeNull()
    expect(screen.queryByText('Ana Lucía Mora')).toBeNull()
  })

  it('shows the usuario, and offers no resend to an account that signs in by email', async () => {
    const payload = view()
    vi.stubGlobal('fetch', fetchWith(payload).mock)
    renderPanel(payload)
    await screen.findByText('Marta Villalobos')

    expect(within(rowOf('marta')).getByText('esph-marta')).toBeTruthy()
    // El rol, which the client asked for by name alongside la persona, el usuario y el correo.
    // Read from the catalogue the rest of the product already uses rather than a second copy
    // of the role names under this screen's own keys.
    expect(within(rowOf('marta')).getByText(es.superadmin.next.users.roles.employee)).toBeTruthy()
    expect(within(rowOf('admin')).getByText(es.superadmin.next.users.roles.company_admin)).toBeTruthy()
    expect(within(rowOf('admin')).getByText(T.noUsuario)).toBeTruthy()
    // Nothing a resend could send, so the row cannot be chosen for one.
    expect(
      within(rowOf('admin')).getByRole('checkbox', { name: T.selectRow.replace('{name}', 'Admin Rojas') }),
    ).toHaveProperty('disabled', true)
  })

  it('opens a row to the demographics the import uploaded', async () => {
    const payload = view()
    vi.stubGlobal('fetch', fetchWith(payload).mock)
    const user = userEvent.setup()
    renderPanel(payload)
    await screen.findByText('Marta Villalobos')

    expect(screen.queryByText('Gerente')).toBeNull()
    await user.click(screen.getByRole('button', { name: T.details.replace('{name}', 'Marta Villalobos') }))

    expect(screen.getByText('Gerente')).toBeTruthy()
    expect(screen.getByText('Más de 10 años')).toBeTruthy()
    expect(screen.getByText('Puesto')).toBeTruthy()
  })

  it('sends the chosen people their details again and reports every one', async () => {
    const payload = view()
    const { mock, sent } = fetchWith(payload, (ids) =>
      ids.map((userId, index) => ({
        userId,
        email: `${userId}@esph.test`,
        delivered: index === 0,
        failureReason: index === 0 ? null : 'mailbox full',
        code: index === 0 ? null : 'send_failed',
      })),
    )
    vi.stubGlobal('fetch', mock)
    const user = userEvent.setup()
    renderPanel(payload)
    await screen.findByText('Marta Villalobos')

    await user.click(within(rowOf('hugo')).getByRole('checkbox'))
    await user.click(within(rowOf('ana')).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: T.send }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].body as { userIds: string[] }).userIds.toSorted()).toEqual(['ana', 'hugo'])

    // A failed send is a 200 with a per-person outcome. Reporting "2 sent" here is the defect
    // this summary exists to prevent.
    expect(
      await screen.findByText(T.sentSome.replace('{sent}', '1').replace('{requested}', '2').replace('{failed}', '1')),
    ).toBeTruthy()
  })

  it('chunks a selection larger than the API cap instead of sending one oversized request', async () => {
    const many = Array.from({ length: 140 }, (_, index) =>
      row({ userId: `p${index}`, name: `Persona ${index}`, status: 'not_started' }),
    )
    const payload = view({ roster: many })
    const { mock, sent } = fetchWith(payload)
    vi.stubGlobal('fetch', mock)
    const user = userEvent.setup()
    renderPanel(payload)
    await screen.findByText('Persona 0')

    await user.click(screen.getByRole('checkbox', { name: T.selectAll }))
    await user.click(screen.getByRole('button', { name: T.send }))

    // 140 people, a cap of 100: two requests, and neither over the cap. One request of 140
    // would be refused by the API with `batch_too_large` and nobody would be mailed.
    await waitFor(() => expect(sent).toHaveLength(2))
    const sizes = sent.map((s) => (s.body as { userIds: string[] }).userIds.length)
    expect(sizes).toEqual([100, 40])
    expect(await screen.findByText(T.sentAll.replace('{sent}', '140').replace('{requested}', '140'))).toBeTruthy()
  })
  /**
   * The defect reading the screenshot caught. On an ANONYMOUS survey no response carries a
   * user id, so every row comes back `not_started` whatever anybody did. Rendering that as
   * participation tells an administrator that 800 people have not answered, beside a notice on
   * the same page saying completion is never recorded against a person — two contradictory
   * claims, one of them false.
   */
  it('never presents state as a fact on a survey that records none', async () => {
    const payload = view({ tracksIndividuals: false })
    vi.stubGlobal('fetch', fetchWith(payload).mock)
    renderPanel(payload)

    expect(await screen.findByText(T.notTracked)).toBeTruthy()
    // The people, their usernames and the resend all stay — only the claim goes.
    expect(screen.getByText('Marta Villalobos')).toBeTruthy()
    expect(screen.getByText('esph-marta')).toBeTruthy()
    expect(screen.queryByText(T.statusNotStarted)).toBeNull()
    expect(screen.queryByText(T.colStatus)).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(`^${T.filterCompleted}`) })).toBeNull()
  })
})

function rowOf(userId: string): HTMLElement {
  return document.querySelector(`tr[data-user-id="${userId}"]`) as HTMLElement
}
