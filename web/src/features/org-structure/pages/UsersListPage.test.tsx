import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import UsersListPage from './UsersListPage'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import type { User } from '../api/users'
import type { Invitation } from '../api/invitations'
import type { Department } from '../api/departments'
import { tokenFor } from '../../../test/jwtFixture'

const COMPANY = 'company-1'

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'm.herrera@acme.example',
    name: 'Mariana Herrera',
    role: 'company_admin',
    departmentId: 'd1',
    isActive: true,
    lastLoginAt: '2026-08-10T18:04:00Z',
    createdAt: '2025-03-14T09:12:00Z',
    ...overrides,
  }
}

function department(overrides: Partial<Department> = {}): Department {
  return {
    id: 'd1',
    companyId: COMPANY,
    name: 'Support',
    description: null,
    parentDepartmentId: null,
    isActive: true,
    employeeCount: 3,
    ...overrides,
  }
}

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: 'i1',
    email: 'n.okafor@acme.example',
    companyId: COMPANY,
    departmentId: null,
    invitationType: 'employee_direct',
    role: 'employee',
    status: 'sent',
    token: 'tok-1',
    expiresAt: '2026-08-24T09:12:00Z',
    sentAt: '2026-08-10T09:12:00Z',
    acceptedAt: null,
    reminderCount: 0,
    ...overrides,
  }
}

interface ServeOptions {
  users?: User[]
  invitations?: Invitation[]
  departments?: Department[] | 'forbidden'
}

function serve({ users = [user()], invitations = [invitation()], departments = [department()] }: ServeOptions = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/admin/users')) {
      return Promise.resolve(new Response(JSON.stringify({ users }), { status: 200 }))
    }
    if (url.includes('/admin/invitations')) {
      return Promise.resolve(new Response(JSON.stringify({ invitations }), { status: 200 }))
    }
    if (url.includes('/admin/departments')) {
      if (departments === 'forbidden') {
        return Promise.resolve(new Response(JSON.stringify({ message: 'nope' }), { status: 403 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ departments }), { status: 200 }))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

function renderPage(locale: 'en' | 'es' = 'en') {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[`/admin/companies/${COMPANY}/users`]}>
        <Routes>
          <Route path="/admin/companies/:companyId/users" element={<UsersListPage />} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  setToken(tokenFor({ role: 'super_admin', companyId: COMPANY, isActive: 'true' }))
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
  vi.unstubAllGlobals()
})

describe('UsersListPage roster', () => {
  it('renders the roster with the department name resolved', async () => {
    serve()

    renderPage()

    expect(await screen.findByText('Mariana Herrera')).toBeTruthy()
    expect(await screen.findByText('Support')).toBeTruthy()
  })

  it('asks the departments endpoint for this company', async () => {
    serve()

    renderPage()

    await screen.findByText('Mariana Herrera')
    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes(`/admin/departments?companyId=${COMPANY}`))).toBe(true)
  })

  it('still shows the roster when the departments request is refused', async () => {
    // The department name is a nicety on one column. A 403 there must not be
    // reported as "the users could not be loaded", because the users loaded.
    serve({ departments: 'forbidden' })

    renderPage()

    expect(await screen.findByText('Mariana Herrera')).toBeTruthy()
    expect(screen.getByText('Unassigned')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports a failed roster request as an error, and shows no table', async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ message: 'boom' }), { status: 500 })),
    )

    renderPage()

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Mariana Herrera')).toBeNull()
  })

  it('counts what is shown against what there is', async () => {
    serve({ users: [user(), user({ id: 'u2', name: 'Andrés Ruiz', email: 'a.ruiz@acme.example' })] })

    renderPage()

    expect(await screen.findByText('2 of 2')).toBeTruthy()
  })

  it('moves the count as the filter narrows the roster', async () => {
    // The filter is client-side and silent: without the count, a query matching
    // nothing looks exactly like a company with no users.
    serve({ users: [user(), user({ id: 'u2', name: 'Andrés Ruiz', email: 'a.ruiz@acme.example' })] })

    renderPage()
    await screen.findByText('2 of 2')

    await userEvent.type(screen.getByRole('searchbox'), 'Ruiz')

    expect(await screen.findByText('1 of 2')).toBeTruthy()
    expect(screen.queryByText('Mariana Herrera')).toBeNull()
  })
})

describe('UsersListPage invite path', () => {
  it('keeps the invite form closed until the header action is pressed', async () => {
    serve()

    renderPage()
    await screen.findByText('Mariana Herrera')

    expect(screen.queryByRole('button', { name: 'Send invitation' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /Invite User/i }))

    expect(await screen.findByRole('button', { name: 'Send invitation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create shareable link' })).toBeTruthy()
  })

  it('keeps the bulk import panel closed until its action is pressed', async () => {
    serve()

    renderPage()
    await screen.findByText('Mariana Herrera')

    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /Bulk import/i }))

    expect(await screen.findByRole('button', { name: 'Preview' })).toBeTruthy()
  })

  it('posts an invitation and reloads the roster', async () => {
    serve()
    renderPage()
    await screen.findByText('Mariana Herrera')

    await userEvent.click(screen.getByRole('button', { name: /Invite User/i }))
    await userEvent.type(await screen.findByLabelText('Email'), 'new.person@acme.example')
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() => {
      const posts = vi
        .mocked(fetch)
        .mock.calls.filter(
          (call) =>
            String(call[0]).endsWith('/admin/invitations') &&
            (call[1] as RequestInit | undefined)?.method === 'POST',
        )
      expect(posts.length).toBe(1)
      expect(String((posts[0][1] as RequestInit).body)).toContain('new.person@acme.example')
    })
  })

  it('lists outstanding invitations with the status and the type in words', async () => {
    serve({ invitations: [invitation({ status: 'sent', invitationType: 'employee_self_signup', email: null })] })

    renderPage()

    expect(await screen.findByText('Sent')).toBeTruthy()
    expect(screen.getByText('Self sign-up')).toBeTruthy()
  })
})

describe('the curated page eyebrow', () => {
  /**
   * The approved design gives this screen the eyebrow "Company Administration". Left to itself
   * `PageTopBar` derives the NAV SECTION instead, which can only ever be one of three
   * words ("Administration", "Workspace", "Communication") — so the design's curated
   * label is a prop the page has to pass, and deleting that prop is completely silent:
   * every other test in this file still passed with it removed. Hence this one.
   */
  it('names the design’s section, not the nav section', () => {
    renderPage()
    const eyebrow = document.querySelector('[data-slot="page-eyebrow"]')
    expect(eyebrow?.textContent).toBe('Company Administration')
  })
})
