import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'
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

/**
 * `fireEvent`, not `userEvent.type` — #283.
 *
 * `userEvent.type` dispatches one event per character and awaits a real timer between
 * them, so every keystroke is a full round trip through React. Timed on this page with
 * a discarded warm-up pass first, the nine interactions below cost **636ms** driven by
 * `userEvent` and **112ms** driven by `fireEvent` on an idle machine. The worst single
 * field is not the schedule but `Question Text`: 278.2ms for 17 characters versus
 * 10.8ms, because `MicroclimateQuestionEditor`'s `onChange` rebuilds the whole
 * `questions` array and re-renders the wizard on each one. The two `datetime-local`
 * fields are 86.9ms versus 5.3ms.
 *
 * That gap is the whole issue: four tests walk this helper. Alternating the old and new
 * file back to back under eight CPU hogs, the slowest single test went 2135/3082/4554ms
 * before and 1431/1301/2734ms after — the 4554ms was 91% of vitest's 5000ms per-test
 * default, which is the margin the issue was filed about.
 *
 * A controlled `Input`/`TextField` cannot tell the two apart. Both end in one `change`
 * event carrying the final value, and both read it the same way: `Input` here takes
 * `event.target.value` directly, and `TextField` wraps exactly that
 * (`onChange={(event) => onChange?.(event.target.value)}` in `FormField.tsx`). What
 * `fireEvent` cannot drive is a Radix `Select`; see `selectOption` below.
 */
function typeInto(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

/**
 * Async `act` rather than a bare `fireEvent.click`: `handleSubmit` awaits `fetch`, and
 * the settled promise has to be flushed inside `act` or React warns and the assertion
 * races the state update. `userEvent.click` did this flushing implicitly.
 */
async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

/**
 * The one interaction that must stay on `userEvent`.
 *
 * `SelectField` renders `@radix-ui/react-select` (see `select.tsx`) — a
 * `SelectPrimitive.Trigger` that carries `role="combobox"`, and a `SelectContent` that
 * lives inside a `SelectPrimitive.Portal` and so is absent from the document until the
 * trigger is opened. `fireEvent.change` has nothing to change, and no `option` exists
 * to be found before the click. This file never fakes timers, so `userEvent` — which
 * deadlocks under `vi.useFakeTimers()` — is safe here.
 */
async function selectOption(optionName: string) {
  await userEvent.click(screen.getByRole('combobox'))
  await userEvent.click(await screen.findByRole('option', { name: optionName }))
}

/** Walks the four content steps with the minimum a session needs. */
async function fillMinimumSession() {
  // Regex for the required fields (the label carries a `*`, see the bilingual test
  // below); exact strings for `Start Time`/`End Time`, which are not required and so
  // have no marker — an exact `'Title'` here fails outright, which is how this was
  // checked rather than assumed.
  typeInto(/Title/, 'Team pulse')
  await press('Next')

  typeInto('Start Time', '2026-08-07T10:00')
  typeInto('End Time', '2026-08-07T10:20')
  await press('Next')

  await press('Next')

  await press('Add Question')
  typeInto(/Question Text/, 'How was the week?')
  await press('Next')
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

    await press('Next')

    expect(screen.getByRole('alert').textContent).toContain('Enter a title.')
    // Still on Basics: the reason is shown, the step does not advance.
    expect(screen.getByLabelText(/Title/)).toBeTruthy()
  })

  it('posts the DTO the backend actually accepts and lands on the new session', async () => {
    renderPage()
    await fillMinimumSession()

    await press('Create microclimate')

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
    await press('Create microclimate')

    expect(await screen.findByText(/Template .* not found/)).toBeTruthy()
    // It did not navigate: the wizard is still on screen with everything typed
    // into it, which is the whole point of showing the refusal rather than a page
    // that has already moved on.
    expect(screen.queryByText('Session page')).toBeNull()
  })

  it('allows going back and keeps what was already typed', async () => {
    renderPage()
    await fillMinimumSession()

    await press('Back')
    await press('Back')
    await press('Back')
    await press('Back')

    expect((screen.getByLabelText(/Title/) as HTMLInputElement).value).toBe('Team pulse')
  })

  it('demands both languages once the content language is Spanish and English', async () => {
    renderPage()

    await selectOption('Spanish and English')

    // Regex, not an exact string. `FormLabel` itself adds nothing; `FormField.tsx`
    // renders `<span aria-hidden="true">*</span>` as a child *inside* the `FormLabel`
    // of a required field, and `getByLabelText` matches the label's text content rather
    // than its accessible name — so `aria-hidden` does not hide the `*` from the query
    // and the string to match is "Title (English)*".
    fireEvent.change(await screen.findByLabelText(/Title \(English\)/), {
      target: { value: 'Team pulse' },
    })
    await press('Next')

    expect(screen.getByRole('alert').textContent).toContain(
      'Enter the title in English and in Spanish.',
    )
  })
})
