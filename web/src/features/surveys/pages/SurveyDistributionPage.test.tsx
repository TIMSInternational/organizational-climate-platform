import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyDistributionPage from './SurveyDistributionPage'
import { TranslationProvider } from '../../../i18n'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'

/** An unsigned JWT carrying just the claims the company context reads. */
function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

const TOKEN = 'not-a-real-token-not-a-real-token-not-a-real'

function surveyRead(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    companyId: 'c1',
    language: 'both',
    status: 'active',
    title: 'Team pulse',
    resolvedLocale: 'en',
    fallbackFields: [],
    departmentIds: [],
    responseCount: 2,
    settings: {
      invitationCustomSubject: 'Your invitation',
      invitationCustomMessage: 'Please answer.',
    },
    ...overrides,
  }
}

function distributionRead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'd1',
    surveyId: 's1',
    accessType: 'tokenized',
    publicLink: null,
    qrCodeUrl: '/surveys/s1',
    accessRules: {
      requireLogin: true,
      allowAnonymous: false,
      singleResponse: true,
      activeOutsideSchedule: false,
      allowedDomains: null,
      blockedIps: null,
      maxResponses: null,
    },
    qrCustomization: { foregroundColor: '#000', backgroundColor: '#fff', logoUrl: null, size: 256 },
    tokenizedLinksGenerated: 0,
    regeneratedCount: 0,
    lastRegeneratedAt: null,
    totalAccesses: 0,
    uniqueVisitors: 0,
    lastAccessedAt: null,
    invitations: {
      total: 2,
      pending: 0,
      sent: 1,
      opened: 0,
      started: 0,
      completed: 1,
      revoked: 0,
      expired: 0,
    },
    anonymity: {
      anonymous: false,
      highestRecordableState: 'completed',
      suppressedStates: [],
      guarantee: 'Tracking runs to completion.',
    },
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function invitationsRead() {
  return {
    invitations: [
      {
        id: 'i1',
        surveyId: 's1',
        userId: 'u1',
        email: 'ada@acme.com',
        status: 'sent',
        isExpired: false,
        sentAt: '2026-08-01T09:00:00Z',
        openedAt: null,
        startedAt: null,
        completedAt: null,
        reminderCount: 0,
        lastReminderSent: null,
        expiresAt: '2026-09-01T00:00:00Z',
        createdAt: '2026-08-01T08:00:00Z',
        // Never returned by the real API. Present here so the assertion that no token
        // reaches the page is a real check rather than a vacuous one.
        invitationToken: TOKEN,
      },
    ],
    summary: distributionRead().invitations,
    anonymity: distributionRead().anonymity,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

/** Routes each request by URL, so ordering changes cannot silently break a test. */
function stubApi(
  overrides: {
    survey?: Record<string, unknown>
    distribution?: Record<string, unknown>
    /** Status for the distribution GET only; the PUT still succeeds, mirroring the real API. */
    distributionStatus?: number
    invitationsStatus?: number
  } = {},
) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/distribution')) {
      if (overrides.distributionStatus !== undefined && init?.method !== 'PUT') {
        return Promise.resolve(
          jsonResponse(
            { message: 'This survey has no distribution configured yet.' },
            overrides.distributionStatus,
          ),
        )
      }
      return Promise.resolve(jsonResponse(distributionRead(overrides.distribution)))
    }
    if (url.includes('/invitations')) {
      if (overrides.invitationsStatus !== undefined) {
        return Promise.resolve(jsonResponse({ message: 'Nope' }, overrides.invitationsStatus))
      }
      return Promise.resolve(jsonResponse(invitationsRead()))
    }
    if (url.includes('/admin/departments')) {
      return Promise.resolve(
        jsonResponse({
          departments: [
            { id: 'eng', companyId: 'c1', name: 'Engineering', description: null, parentDepartmentId: null, isActive: true, employeeCount: 2 },
          ],
        }),
      )
    }
    if (url.includes('/admin/users') || url.includes('/users?')) {
      return Promise.resolve(
        jsonResponse({
          users: [
            { id: 'u1', email: 'ada@acme.com', name: 'Ada', role: 'employee', departmentId: 'eng', isActive: true, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' },
            { id: 'u2', email: 'bob@acme.com', name: 'Bob', role: 'employee', departmentId: 'eng', isActive: true, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' },
          ],
        }),
      )
    }
    return Promise.resolve(jsonResponse(surveyRead(overrides.survey)))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage() {
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={['/surveys/s1/distribution']}>
          <Routes>
            <Route path="/surveys/:surveyId/distribution" element={<SurveyDistributionPage />} />
          </Routes>
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

describe('SurveyDistributionPage', () => {
  beforeEach(() => {
    setToken(tokenFor({ role: 'company_admin', companyId: 'c1' }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
    vi.unstubAllGlobals()
  })

  /**
   * The rule the whole page is built around. The invitation payload here *does* carry a
   * token; nothing on screen may show it, in text or in markup.
   */
  it('never renders an invitation token anywhere on the page', async () => {
    stubApi()
    const { container } = renderPage()

    await screen.findByText('ada@acme.com')
    expect(container.textContent).not.toContain(TOKEN)
    expect(container.innerHTML).not.toContain(TOKEN)
  })

  it('shows who was invited, who responded and what is outstanding', async () => {
    stubApi()
    const { container } = renderPage()

    await screen.findByText('Participation')
    // Scoped to the stats list: "Invited" is also a column header in the table below,
    // and an unscoped query would pass on either one.
    const stats = within(container.querySelector('dl') as HTMLElement)
    expect(stats.getByText('Invited').parentElement?.querySelector('dd')?.textContent).toBe('2')
    expect(stats.getByText('Responded').parentElement?.querySelector('dd')?.textContent).toBe('1')
    expect(stats.getByText('Outstanding').parentElement?.querySelector('dd')?.textContent).toBe('1')
  })

  /**
   * A survey nobody has distributed answers the GET with 404 -- the normal state of
   * every survey ever created. That is an empty state with a way out, not an error,
   * and above all not the permanent fake "Loading..." it used to be.
   */
  it('treats a missing distribution as an empty state whose action creates one', async () => {
    const fetchMock = stubApi({ distributionStatus: 404 })
    renderPage()

    await screen.findByText('This survey has not been distributed yet.')
    expect(screen.queryByText('Loading...')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Set up distribution' }))

    // The PUT is what creates the row; its response is the distribution the page mounts.
    await screen.findByText('Participation')
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PUT')
    expect(put).toBeDefined()
    expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({ accessType: 'tokenized' })
  })

  it('offers no create action on the empty state of another tenant\'s survey', async () => {
    stubApi({ survey: { companyId: 'other-company' }, distributionStatus: 404 })
    renderPage()

    await screen.findByText('This survey has not been distributed yet.')
    expect(screen.queryByRole('button', { name: 'Set up distribution' })).toBeNull()
  })

  it('renders a retry on a real load failure instead of loading forever', async () => {
    const fetchMock = stubApi({ invitationsStatus: 500 })
    renderPage()

    await screen.findByText('The distribution details could not be loaded.')
    expect(screen.queryByText('Loading...')).toBeNull()

    const callsBefore = fetchMock.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    // Still failing, so the retry lands back on the same screen -- but it must have
    // actually refetched rather than being a dead button.
    await screen.findByText('The distribution details could not be loaded.')
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore))
  })

  /**
   * A CompanyAdmin looking at another tenant's survey gets no picker at all.
   *
   * The server would refuse the send, and would refuse the user/department listing too —
   * but presenting the option is itself a disclosure that the other tenant's departments
   * exist, and it converts a clear refusal into a confusing 403 after the fact.
   */
  it('offers no audience at all for a survey belonging to another company', async () => {
    stubApi({ survey: { companyId: 'other-company' } })
    const fetchMock = vi.mocked(fetch)
    renderPage()

    await screen.findByText(/belongs to another company/)
    expect(screen.queryByRole('button', { name: 'Send invitations' })).toBeNull()
    // And it never asked for the other company's people in the first place.
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('/admin/users'))).toBe(false)
    expect(urls.some((url) => url.includes('/admin/departments'))).toBe(false)
  })

  it('scopes the audience lists to the survey’s own company', async () => {
    const fetchMock = stubApi()
    renderPage()

    await screen.findByRole('button', { name: 'Send invitations' })
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('companyId=c1'))).toBe(true)
    expect(urls.some((url) => /companyId=(?!c1)/.test(url))).toBe(false)
  })

  it('confirms with a recipient count before dispatching, because sending is not undoable', async () => {
    const fetchMock = stubApi()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Send invitations' }))

    expect(screen.getByText('This will invite 2 people and cannot be undone.')).toBeTruthy()
    // Nothing has been posted yet — the dialog is a gate, not a receipt.
    expect(
      fetchMock.mock.calls.filter(
        (call) => String(call[0]).endsWith('/invitations') && call[1]?.method === 'POST',
      ),
    ).toHaveLength(0)
  })

  it('posts exactly one selector once the dispatch is confirmed', async () => {
    const fetchMock = stubApi()
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Send invitations' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitations' }))

    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        (call) => String(call[0]).endsWith('/invitations') && call[1]?.method === 'POST',
      )
      expect(posts).toHaveLength(1)
      expect(JSON.parse(String(posts[0][1]?.body))).toEqual({ allTargeted: true })
    })
  })

  it('reads the survey once per locale so both languages can be edited side by side', async () => {
    const fetchMock = stubApi()
    renderPage()

    await screen.findByRole('heading', { name: 'English' })
    expect(screen.getByRole('heading', { name: 'Spanish' })).toBeTruthy()

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    // Path and query only -- see the note in SurveyResultsPage.test.tsx on why the API
    // base is not pinned here.
    expect(urls.some((url) => /\/surveys\/s1\?lang=en$/.test(url))).toBe(true)
    expect(urls.some((url) => /\/surveys\/s1\?lang=es$/.test(url))).toBe(true)
  })

  it('surfaces a failed action instead of leaving the page looking successful', async () => {
    stubApi()
    renderPage()
    await screen.findByRole('button', { name: 'Send reminders' })

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ message: 'Nope' }, 409))
    await userEvent.click(screen.getByRole('button', { name: 'Send reminders' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
