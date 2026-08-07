import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import MicroclimateCreatePage from './MicroclimateCreatePage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../company-context'

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

/** Templates for the picker, and the created microclimate for the POST. */
function routeFetch(created: Record<string, unknown> = { id: 'm-new' }) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/microclimate-templates')) {
      return Promise.resolve(new Response(JSON.stringify({ templates: [] }), { status: 200 }))
    }
    if (init?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify(created), { status: 201 }))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/microclimates/new']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/microclimates/new" element={<MicroclimateCreatePage />} />
            <Route path="/microclimates/:id" element={<p>Session page</p>} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function postBody(): Record<string, unknown> {
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
  // Thrown rather than optional-chained into a cast: "cannot read body of
  // undefined" three lines later hides the actual failure, which is that no POST
  // was made at all.
  if (!call) throw new Error('expected a POST to /microclimates')
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>
}

/** Walks the four content steps with the minimum a session needs. */
async function fillMinimumSession() {
  await userEvent.type(screen.getByLabelText(/Title/), 'Team pulse')
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))

  await userEvent.type(screen.getByLabelText('Start Time'), '2026-08-07T10:00')
  await userEvent.type(screen.getByLabelText('End Time'), '2026-08-07T10:20')
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))

  await userEvent.click(screen.getByRole('button', { name: 'Next' }))

  await userEvent.click(screen.getByRole('button', { name: 'Add Question' }))
  await userEvent.type(screen.getByLabelText(/Question Text/), 'How was the week?')
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
}

beforeEach(() => {
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  setToken(tokenFor({ role: 'company_admin', companyId: 'company-1' }))
  vi.stubGlobal('fetch', vi.fn())
  routeFetch()
})

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('MicroclimateCreatePage', () => {
  it('asks a super admin which company they mean rather than filing the session under a guess', async () => {
    setToken(tokenFor({ role: 'super_admin', companyId: '' }))
    renderPage()

    expect(await screen.findByText('Choose a company')).toBeTruthy()
  })

  it('blocks the first step until there is a title, and says why', async () => {
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('alert').textContent).toContain('Enter a title.')
    // Still on Basics: the reason is shown, the step does not advance.
    expect(screen.getByLabelText(/Title/)).toBeTruthy()
  })

  it('posts the DTO the backend actually accepts and lands on the new session', async () => {
    renderPage()
    await fillMinimumSession()

    await userEvent.click(screen.getByRole('button', { name: 'Create microclimate' }))

    await waitFor(() => expect(screen.getByText('Session page')).toBeTruthy())

    const body = postBody()
    expect(body.title).toBe('Team pulse')
    expect(body.companyId).toBe('company-1')
    expect(body.targetParticipantCount).toBe(10)
    expect(body.anonymousResponses).toBe(true)
    expect(body.language).toBe('en')
    expect(body.questions).toHaveLength(1)
    // `createMicroclimate` converts the wall-clock strings to UTC and stamps the
    // browser's timezone -- neither is the page's job, and doing it twice is how the
    // reinterpreted-wall-clock bug comes back.
    expect(String(body.startTime)).toMatch(/Z$/)
    expect(typeof body.timezone).toBe('string')
    // Not in the request record, so not invented here.
    expect('departmentIds' in body).toBe(false)
    expect('status' in body).toBe(false)
  })

  it('says up front that it can only create a draft', async () => {
    // `CreateAsync` hardcodes Status = "draft". Finding that out afterwards, on a
    // session that is quietly not collecting anything, is the failure this avoids.
    renderPage()
    await fillMinimumSession()

    expect(screen.getByText(/created as a draft/i)).toBeTruthy()
  })

  it('renders the server refusal verbatim instead of a generic failure', async () => {
    renderPage()
    await fillMinimumSession()

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Template 00000000-0000-0000-0000-000000000000 not found' }), {
        status: 400,
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create microclimate' }))

    expect(await screen.findByText(/Template .* not found/)).toBeTruthy()
    // It did not navigate: the wizard is still on screen with everything typed
    // into it, which is the whole point of showing the refusal rather than a page
    // that has already moved on.
    expect(screen.queryByText('Session page')).toBeNull()
  })

  it('allows going back and keeps what was already typed', async () => {
    renderPage()
    await fillMinimumSession()

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect((screen.getByLabelText(/Title/) as HTMLInputElement).value).toBe('Team pulse')
  })

  it('demands both languages once the content language is Spanish and English', async () => {
    renderPage()

    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: 'Spanish and English' }))

    // Regex, not an exact string: `FormLabel` appends a `*` for a required field, so
    // the label's text content is "Title (English)*".
    await userEvent.type(await screen.findByLabelText(/Title \(English\)/), 'Team pulse')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('alert').textContent).toContain(
      'Enter the title in English and in Spanish.',
    )
  })
})
