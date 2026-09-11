import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import raw from '../../../../../scripts/shot-fixtures/super-meridiano.json?raw'
import UsersNextPage from '../UsersNextPage'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { CompanyContextProvider } from '../../../../company-context'
import { clearToken, setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import { LUIS_MORA_ID, MERIDIANO_ID, superMeridianoFetch } from '../../../../test/superMeridianoFetch'
import type { Department } from '../../api/departments'
import type { User } from '../../api/users'
import es from '../../../../i18n/es.json'

/**
 * The company administrator's *Usuarios* (`UsersList` artboard) through its real route page,
 * `UsersNextPage`, answered from the Meridiano capture the shots use
 * (`scripts/shot-fixtures/super-meridiano.json`: Grupo Meridiano S.A.'s own reads). Every
 * expected count is computed here from that payload, so a number the screen types instead
 * of deriving fails.
 */
const FIXTURE = JSON.parse(raw) as Record<string, unknown>
const USERS = (FIXTURE['GET /admin/users'] as { users: User[] }).users
const DEPARTMENTS = (FIXTURE['GET /admin/departments'] as { departments: Department[] }).departments
const ANA_ROJAS_ID = '7b34dd6e-3472-4180-9873-ec5cf7d2af65'
const T = es.users.next

function fill(text: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((out, [key, value]) => out.replace(`{${key}}`, String(value)), text)
}

type Override = () => Response
function fetchWith(overrides: Record<string, Override> = {}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const pathname = new URL(String(input), 'http://api.test').pathname.replace(/^\/undefined(?=\/)/, '')
    const override = overrides[`${(init?.method ?? 'GET').toUpperCase()} ${pathname}`]
    return override ? Promise.resolve(override()) : superMeridianoFetch(input, init)
  })
}

function renderAt(url: string) {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[url]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/admin/companies/:companyId/users" element={<UsersNextPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const ROUTE = `/admin/companies/${MERIDIANO_ID}/users`
const rows = () => [...document.querySelectorAll('tr[data-user-id]')]

describe('AdminUsersView (company administrator)', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken(tokenFor({ role: 'company_admin', companyId: MERIDIANO_ID, sub: ANA_ROJAS_ID }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('prints the tallies the payload holds: never-signed-in leaders, empty departments, no invitations', async () => {
    vi.stubGlobal('fetch', fetchWith())
    renderAt(ROUTE)
    const leaders = USERS.filter((user) => user.role === 'leader')
    const leadersNever = leaders.filter((user) => user.lastLoginAt === null).length
    expect(await screen.findByText(fill(T.tiles.neverLeaders, { never: leadersNever, leaders: leaders.length }))).toBeTruthy()
    expect(screen.getByText(T.tiles.noneDeactivated)).toBeTruthy()
    const occupied = new Set(USERS.map((user) => user.departmentId))
    const inactiveEmpty = DEPARTMENTS.filter((unit) => !unit.isActive && !occupied.has(unit.id)).length
    const without = USERS.filter((user) => user.departmentId === null).length
    expect(
      screen.getByText(
        `${fill(T.tiles.withoutDepartment, { count: without })} · ${fill(T.tiles.inactiveEmpty, { count: inactiveEmpty })}`,
      ),
    ).toBeTruthy()
    expect(screen.getByText(T.tiles.invitationsNone)).toBeTruthy()
    expect(rows()).toHaveLength(USERS.length)
  })

  it('spells the rail’s department count as the board writes it inside a sentence', async () => {
    vi.stubGlobal('fetch', fetchWith())
    renderAt(ROUTE)
    // One rail entry per department that has people; the people with none are the administration.
    const named = new Set(USERS.flatMap((user) => (user.departmentId ? [user.departmentId] : []))).size
    expect(USERS.filter((user) => user.departmentId === null).every((user) => user.role === 'company_admin')).toBe(true)
    const word = es.dashboard.next.countWord[String(named) as keyof typeof es.dashboard.next.countWord]
    expect(word).toBeTruthy()
    expect(await screen.findByText(fill(T.rail.allSub, { count: word }))).toBeTruthy()
    expect(screen.queryByText(fill(T.rail.allSub, { count: named }))).toBeNull()
  })

  it('filters the roster by the department picked on the rail, leaders first', async () => {
    vi.stubGlobal('fetch', fetchWith())
    const user = userEvent.setup()
    renderAt(ROUTE)
    const ingenieria = DEPARTMENTS.find((unit) => unit.name === 'Ingeniería')!
    const members = USERS.filter((person) => person.departmentId === ingenieria.id)
    await user.click(await screen.findByRole('button', { name: /^Ingeniería/ }))
    expect(screen.getByRole('heading', { name: 'Ingeniería' })).toBeTruthy()
    expect(rows()).toHaveLength(members.length)
    expect(rows()[0].getAttribute('data-user-id')).toBe(LUIS_MORA_ID)
    const never = members.filter((person) => person.lastLoginAt === null).length
    expect(screen.getByText(fill(T.roster.sub, { never }))).toBeTruthy()
  })

  it('counts what the search leaves against the whole tenant', async () => {
    vi.stubGlobal('fetch', fetchWith())
    const user = userEvent.setup()
    renderAt(ROUTE)
    await user.type(await screen.findByPlaceholderText(T.roster.search), 'luis.mora')
    expect(screen.getByText(fill(T.roster.shown, { shown: 1, total: USERS.length }))).toBeTruthy()
    expect(rows()).toHaveLength(1)
  })

  it('shows the role locked and saves the profile without asking for a role change', async () => {
    const fetchMock = fetchWith()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderAt(`${ROUTE}?editar=${LUIS_MORA_ID}`)
    expect(await screen.findByRole('heading', { name: fill(T.edit.title, { name: 'Luis Mora' }) })).toBeTruthy()
    expect((screen.getByLabelText(T.edit.role) as HTMLInputElement).readOnly).toBe(true)
    expect(screen.getByText(T.edit.roleLocked)).toBeTruthy()
    const name = screen.getByLabelText(T.edit.name)
    await user.clear(name)
    await user.type(name, 'Luis Mora Solano')
    await user.click(screen.getByRole('button', { name: T.edit.save }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith(`/admin/users/${LUIS_MORA_ID}`) && init?.method === 'PUT')).toBe(true),
    )
    const put = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith(`/admin/users/${LUIS_MORA_ID}`) && init?.method === 'PUT')!
    expect(JSON.parse(String(put[1]!.body))).toEqual({ name: 'Luis Mora Solano' })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/role'))).toBe(false)
  })

  it('locks the account switch on an administrator, which only a super administrator may deactivate', async () => {
    vi.stubGlobal('fetch', fetchWith())
    renderAt(`${ROUTE}?editar=${ANA_ROJAS_ID}`)
    await screen.findByRole('heading', { name: fill(T.edit.title, { name: 'Ana Rojas' }) })
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(T.edit.accountLocked)).toBeTruthy()
  })

  it('never offers the company-administrator setup invitation, which the server refuses this role', async () => {
    vi.stubGlobal('fetch', fetchWith())
    const user = userEvent.setup()
    renderAt(ROUTE)
    await user.click(await screen.findByRole('button', { name: T.invite }))
    const panel = screen.getByRole('region', { name: T.invite })
    expect(within(panel).queryByRole('option', { name: es.users.companyAdmin })).toBeNull()
  })

  it('marks a deactivated person with the chip and counts them', async () => {
    const off = USERS.find((person) => person.role === 'employee')!
    vi.stubGlobal(
      'fetch',
      fetchWith({
        'GET /admin/users': () =>
          new Response(JSON.stringify({ users: USERS.map((person) => (person.id === off.id ? { ...person, isActive: false } : person)) })),
      }),
    )
    renderAt(ROUTE)
    expect(await screen.findByText(T.tiles.deactivatedOne)).toBeTruthy()
    const row = rows().find((element) => element.getAttribute('data-user-id') === off.id)!
    expect(within(row as HTMLElement).getByText(T.roster.deactivated)).toBeTruthy()
  })

  it('keeps the roster when the department list is refused, and prints no department count', async () => {
    vi.stubGlobal('fetch', fetchWith({ 'GET /admin/departments': () => new Response(null, { status: 403 }) }))
    renderAt(ROUTE)
    expect(await screen.findByText(T.tiles.departmentsUnavailable)).toBeTruthy()
    expect(rows()).toHaveLength(USERS.length)
  })

  it('never reads an unread invitation list as nobody pending', async () => {
    vi.stubGlobal('fetch', fetchWith({ 'GET /admin/invitations': () => new Response(null, { status: 500 }) }))
    renderAt(ROUTE)
    expect(await screen.findByText(T.tiles.invitationsUnavailable)).toBeTruthy()
    expect(screen.getByText(T.invitations.unavailable)).toBeTruthy()
    expect(screen.queryByText(T.tiles.invitationsNone)).toBeNull()
    expect(screen.queryByText(T.invitations.empty)).toBeNull()
  })

  it('reports a refused roster as an error and draws no table', async () => {
    vi.stubGlobal('fetch', fetchWith({ 'GET /admin/users': () => new Response(null, { status: 500 }) }))
    renderAt(ROUTE)
    expect(await screen.findByText(T.loadFailed)).toBeTruthy()
    expect(rows()).toHaveLength(0)
  })

  it('tells a leader the page is not theirs and asks the server for nothing', async () => {
    setToken(tokenFor({ role: 'leader', companyId: MERIDIANO_ID }))
    const fetchMock = fetchWith()
    vi.stubGlobal('fetch', fetchMock)
    renderAt(ROUTE)
    expect(await screen.findByText(T.forbidden)).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/admin/users'))).toBe(false)
    expect(screen.queryByRole('button', { name: T.invite })).toBeNull()
  })
})
