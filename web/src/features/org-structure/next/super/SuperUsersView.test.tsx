import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import UsersListPage from '../../pages/UsersListPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../../i18n'
import { CompanyContextProvider } from '../../../../company-context'
import { setToken, clearToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import en from '../../../../i18n/en.json'

/**
 * `/admin/companies/:companyId/users` for a super administrator — the per-role canvas's
 * Usuarios. Rendered through `UsersListPage`, so the dispatch is pinned with the view;
 * `UsersListPage.test.tsx` keeps pinning the page a company administrator gets.
 */
const copy = en.superadmin.next.users
const C = 'c1'

function person(id: string, name: string, role: string, extra: object = {}) {
  return {
    id,
    email: `${id}@meridiano.test`,
    name,
    role,
    departmentId: 'ing',
    isActive: true,
    lastLoginAt: '2026-09-10T02:00:00Z',
    createdAt: '2026-09-10T00:00:00Z',
    ...extra,
  }
}

// Twelve people, so the canvas's ten-row page has something to hold back.
const PEOPLE = [
  person('ana', 'Ana Rojas', 'company_admin', { departmentId: null }),
  person('luis', 'Luis Mora', 'leader'),
  person('carla', 'Carla Jimenez', 'leader', { departmentId: 'fin', lastLoginAt: null }),
  person('sofia', 'Sofia Vargas', 'supervisor'),
  ...Array.from({ length: 8 }, (_, index) => person(`e${index}`, `Empleado ${String.fromCharCode(65 + index)}`, 'employee')),
]

interface Call {
  method: string
  url: string
  body: string | undefined
}
let calls: Call[] = []

function serve({ invitations = 'ok' as 'ok' | 'fail', saved = {} as object } = {}) {
  calls = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined })
    const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    if (method === 'PUT' && url.includes('/admin/users/')) return ok({ ...PEOPLE[1], companyId: C, managerId: null, ...saved })
    if (url.includes('/admin/users')) return ok({ users: PEOPLE })
    if (url.includes('/admin/invitations')) {
      return invitations === 'ok' ? ok({ invitations: [] }) : Promise.resolve(new Response(null, { status: 500 }))
    }
    if (url.includes('/admin/departments')) {
      return ok({
        departments: [
          { id: 'ing', companyId: C, name: 'Ingeniería', description: null, parentDepartmentId: null, isActive: true, employeeCount: 10 },
          { id: 'fin', companyId: C, name: 'Finanzas', description: null, parentDepartmentId: null, isActive: true, employeeCount: 1 },
        ],
      })
    }
    if (url.includes(`/admin/companies/${C}`)) {
      return ok({ id: C, name: 'Grupo Meridiano S.A.', emailDomain: null, industry: null, size: null, country: null, subscriptionTier: null, createdAt: '2026-09-10T00:00:00Z', userCount: 12 })
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function renderPage(entry = `/admin/companies/${C}/users`) {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[entry]}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/admin/companies/:companyId/users" element={<UsersListPage />} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const bodyRows = () => screen.getAllByRole('row').slice(1)

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken(tokenFor({ role: 'super_admin', companyId: '' }))
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('SuperUsersView', () => {
  it('names the tenant, orders the roster by role and name, and shows ten with a count of the rest', async () => {
    serve()
    renderPage()
    expect(await screen.findByRole('link', { name: 'Grupo Meridiano S.A.' })).toBeTruthy()
    await screen.findByText('Ana Rojas')
    expect(bodyRows().map((row) => row.getAttribute('data-role')).slice(0, 4)).toEqual(['company_admin', 'leader', 'leader', 'supervisor'])
    expect(bodyRows()).toHaveLength(10)
    expect(screen.getByText(new RegExp(copy.moreMany.replace('{count}', '2').replace(/[.…]/g, '.')))).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: copy.showAll }))
    expect(bodyRows()).toHaveLength(12)
  })

  it('narrows by a role facet and by department', async () => {
    serve()
    renderPage()
    await screen.findByText('Ana Rojas')
    await userEvent.click(screen.getByRole('button', { name: copy.roleLeader.replace('{count}', '2') }))
    expect(bodyRows().map((row) => row.getAttribute('data-user-id'))).toEqual(['carla', 'luis'])
    await userEvent.click(screen.getByRole('button', { name: copy.roleAll.replace('{count}', '12') }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: copy.departmentFilterLabel }), 'fin')
    expect(bodyRows().map((row) => row.getAttribute('data-user-id'))).toEqual(['carla'])
  })

  it('lets a super administrator assign any role: the profile first, then the role', async () => {
    serve()
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: copy.editNamed.replace('{name}', 'Luis Mora') }))
    const role = screen.getByLabelText(new RegExp(`^${copy.role}`)) as HTMLSelectElement
    expect(role.disabled).toBe(false)
    expect([...role.options].map((option) => option.value)).toContain('company_admin')
    await userEvent.selectOptions(role, 'company_admin')
    await userEvent.click(screen.getByRole('button', { name: copy.save }))
    await waitFor(() => expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2))
    const [profile, roleChange] = calls.filter((call) => call.method === 'PUT')
    expect(profile.url).toMatch(/\/admin\/users\/luis$/)
    expect(JSON.parse(profile.body ?? '')).toMatchObject({ name: 'Luis Mora', isActive: true })
    expect(roleChange.url).toMatch(/\/admin\/users\/luis\/role$/)
    expect(JSON.parse(roleChange.body ?? '')).toEqual({ role: 'company_admin' })
  })

  it('corrects an address and says what that did: nothing sent, no codes left, an old invitation cancelled', async () => {
    serve({
      saved: {
        email: 'luis.mora@correo-real.cr',
        emailChange: { previousEmail: 'luis@meridiano.test', unusedSurveyCodes: 0, pendingInvitationsExpired: 1 },
      },
    })
    renderPage(`/admin/companies/${C}/users?editar=luis`)
    await screen.findByDisplayValue('Luis Mora')
    const email = screen.getByLabelText(copy.email)
    await userEvent.clear(email)
    await userEvent.type(email, 'luis.mora@correo-real.cr')
    await userEvent.click(screen.getByRole('button', { name: copy.save }))

    const edit = en.users.next.edit
    expect(
      await screen.findByText(edit.emailChanged.replace('{previous}', 'luis@meridiano.test').replace('{current}', 'luis.mora@correo-real.cr')),
    ).toBeTruthy()
    expect(screen.getByText(edit.emailCodesNone)).toBeTruthy()
    expect(screen.getByText(edit.emailInvitationsExpiredOne)).toBeTruthy()
    const profile = calls.find((call) => call.method === 'PUT')!
    expect(JSON.parse(profile.body ?? '')).toMatchObject({ email: 'luis.mora@correo-real.cr' })
  })

  it('offers "no department" to everyone, and taking a department away sends an explicit clear', async () => {
    serve()
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: copy.editNamed.replace('{name}', 'Luis Mora') }))
    const department = screen.getByLabelText(new RegExp(`^${copy.department}`)) as HTMLSelectElement
    expect([...department.options].map((option) => option.textContent)).toContain(copy.noDepartment)
    await userEvent.selectOptions(department, '')
    await userEvent.click(screen.getByRole('button', { name: copy.save }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true))
    const profile = calls.find((call) => call.method === 'PUT')!
    const body = JSON.parse(profile.body ?? '') as Record<string, unknown>
    expect(body).toMatchObject({ clearDepartment: true })
    expect(body).not.toHaveProperty('departmentId')
  })

  it('asks before deactivating and names what happens to their survey codes', async () => {
    serve()
    renderPage(`/admin/companies/${C}/users?editar=luis`)
    await screen.findByDisplayValue('Luis Mora')
    await userEvent.click(screen.getByRole('switch'))
    await userEvent.click(screen.getByRole('button', { name: copy.save }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(en.users.next.edit.deactivateBody)).toBeTruthy()
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)
    await userEvent.click(within(dialog).getByRole('button', { name: en.users.next.edit.deactivateConfirm }))
    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true))
    expect(JSON.parse(calls.find((call) => call.method === 'PUT')!.body ?? '')).toMatchObject({ isActive: false })
  })

  it('offers a super administrator the password reset on an administrator too', async () => {
    serve()
    renderPage(`/admin/companies/${C}/users?editar=ana`)
    await screen.findByDisplayValue('Ana Rojas')
    // Drawn only once the person's detail read settles (`ResetPassword`), a second request
    // that can land after the name does.
    expect(await screen.findByRole('button', { name: en.users.next.edit.resetPassword })).toBeTruthy()
  })

  it('writes "never signed in" in words rather than leaving a blank date', async () => {
    serve()
    renderPage()
    const row = (await screen.findByText('Carla Jimenez')).closest('tr') as HTMLElement
    expect(within(row).getByText(copy.neverSignedIn)).toBeTruthy()
  })

  it('says "none pending" only about an invitation list it read', async () => {
    serve({ invitations: 'fail' })
    renderPage()
    await screen.findByText('Ana Rojas')
    expect(screen.getByText(en.superadmin.next.unavailable)).toBeTruthy()
    expect(screen.queryByText(copy.invitations.noneMeta)).toBeNull()
  })

  it('draws the email as an editable input like the name beside it, with its mail glyph and what changing it does', async () => {
    serve()
    renderPage(`/admin/companies/${C}/users?editar=luis`)
    await screen.findByDisplayValue('Luis Mora')
    const field = document.querySelector('[data-slot="email-field"]') as HTMLElement
    expect(field.className.split(/\s+/)).toContain('bg-surface-input')
    expect(field.className.split(/\s+/)).not.toContain('bg-surface-icon-box')
    expect(field.querySelector('.lucide-mail')).not.toBeNull()
    expect((field.querySelector('input') as HTMLInputElement).readOnly).toBe(false)
    expect(screen.getByText(en.users.next.edit.emailHelper)).toBeTruthy()
  })

  it('opens the edit panel on the person the link names (?editar=), and on nobody for an id outside the tenant', async () => {
    serve()
    const first = renderPage(`/admin/companies/${C}/users?editar=luis`)
    expect(await screen.findByDisplayValue('Luis Mora')).toBeTruthy()
    expect(document.querySelector('[data-user-id="luis"]')?.getAttribute('aria-selected') ?? document.querySelector('[data-user-id="luis"]')?.className).toBeTruthy()
    first.unmount()
    renderPage(`/admin/companies/${C}/users?editar=nobody`)
    await screen.findAllByRole('row')
    expect(screen.queryByDisplayValue('Luis Mora')).toBeNull()
  })
})
