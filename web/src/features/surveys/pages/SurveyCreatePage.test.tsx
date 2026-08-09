import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import SurveyCreatePage from './SurveyCreatePage'
import { TranslationProvider } from '../../../i18n'
import { LOCALE_STORAGE_KEY } from '../../../i18n/locale'
import { setToken, clearToken } from '../../../auth/token'
import { CompanyContextProvider } from '../../../company-context'
import { SURVEY_DRAFT_CONTENT_VERSION } from '../draftContent'

/**
 * The survey wizard's autosave and recovery (#266).
 *
 * `SurveyDraftEndpoints` (#105) shipped complete and unreachable, so what is worth
 * asserting here is not that the endpoints work — the integration tests cover that — but
 * that the *client* uses them in the ways the feature is only worth having if it does:
 * it writes nothing until there is something to write, it says out loud when it has
 * stopped saving, it sends the version guard, and it can put a recovered draft back on
 * the screen at the step it was left on.
 */

const AUTOSAVE_DELAY_MS = 1500

function tokenFor(claims: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}

interface DraftOverrides {
  id?: string
  version?: number
  currentStep?: number
  title?: string | null
  content?: unknown
  updatedAt?: string
}

function draftResponse(overrides: DraftOverrides = {}) {
  return {
    id: overrides.id ?? 'draft-1',
    sessionId: 'session-1',
    companyId: 'company-1',
    title: overrides.title ?? 'Quarterly pulse',
    description: null,
    language: 'en',
    resolvedLocale: 'en',
    fallbackFields: [],
    missingTranslations: [],
    isTranslationComplete: true,
    content: overrides.content ?? null,
    currentStep: overrides.currentStep ?? 1,
    lastEditedField: null,
    version: overrides.version ?? 1,
    autoSaveCount: 0,
    isRecovered: false,
    lastAutosaveAt: null,
    expiresAt: '2026-12-01T00:00:00Z',
    createdAt: '2026-08-08T10:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-08-08T10:05:00Z',
  }
}

/** A stored wizard snapshot, in the shape `draftContent.ts` writes. */
function storedContent(overrides: Record<string, unknown> = {}) {
  return {
    version: SURVEY_DRAFT_CONTENT_VERSION,
    language: 'en',
    titleEn: 'Recovered pulse',
    titleEs: '',
    descriptionEn: '',
    descriptionEs: '',
    type: 'pulse',
    startDate: '2026-09-01T09:00',
    endDate: '2026-09-08T17:00',
    departmentIds: [],
    targetAudienceCount: '',
    anonymous: true,
    allowPartialResponses: true,
    showProgress: true,
    questions: [
      {
        textEn: 'What went well?',
        textEs: '',
        type: 'open_ended',
        required: true,
        options: [],
      },
    ],
    ...overrides,
  }
}

interface RouteOptions {
  latest?: unknown
  /** Status + body for every draft write. Defaults to a successful autosave. */
  writeStatus?: number
  writeBody?: unknown
}

/** Records every call so a test can assert on what was sent, not only that it rendered. */
const calls: { url: string; method: string; body: unknown }[] = []

function routeFetch(options: RouteOptions = {}) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })

    // Before the bare `/surveys/drafts` check: `/latest` contains it as a prefix.
    if (url.includes('/surveys/drafts/latest')) {
      return Promise.resolve(
        new Response(JSON.stringify({ draft: options.latest ?? null }), { status: 200 }),
      )
    }
    if (url.includes('/surveys/drafts')) {
      if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
      if (url.includes('/recover')) {
        return Promise.resolve(new Response(JSON.stringify(draftResponse()), { status: 200 }))
      }
      const status = options.writeStatus ?? 200
      const body = options.writeBody ?? draftResponse({ version: 2 })
      return Promise.resolve(new Response(JSON.stringify(body), { status }))
    }
    if (url.includes('/admin/departments')) {
      return Promise.resolve(new Response(JSON.stringify({ departments: [] }), { status: 200 }))
    }
    if (url.includes('/surveys') && method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify({ id: 'survey-new' }), { status: 201 }))
    }
    return Promise.resolve(new Response('{}', { status: 200 }))
  })
}

function renderPage() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/surveys/new']}>
        <CompanyContextProvider>
          <Routes>
            <Route path="/surveys/new" element={<SurveyCreatePage />} />
            <Route path="/surveys/:id" element={<p>Survey page</p>} />
          </Routes>
        </CompanyContextProvider>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

function draftWrites() {
  return calls.filter((call) => call.url.includes('/surveys/drafts') && call.method !== 'GET')
}

/** Lets the mount effects settle without advancing past the autosave debounce. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function tick(ms = AUTOSAVE_DELAY_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  calls.length = 0
  localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
  sessionStorage.clear()
  setToken(tokenFor({ role: 'company_admin', companyId: 'company-1' }))
  vi.stubGlobal('fetch', vi.fn())
  routeFetch()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  clearToken()
  localStorage.clear()
  sessionStorage.clear()
})

/**
 * `fireEvent`, not `userEvent`, and the reason is worth recording: `userEvent` awaits a
 * real `setTimeout` between keystrokes, and under `vi.useFakeTimers()` that await never
 * settles -- every interacting test in this file hung for its full timeout before this
 * was swapped. Passing `advanceTimers` does not help, because the faked clock also
 * covers the microtask plumbing RTL itself is waiting on. `fireEvent` is synchronous and
 * has no such dependency, and a controlled `TextField` cannot tell the difference.
 */
async function typeInto(label: RegExp, value: string) {
  // Regex, never an exact string: `FormField` appends a `*` inside the <label> of a
  // required field, so `getByLabelText('Start Date')` misses it while the page renders
  // perfectly. It cost a red test here before it was noticed.
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  })
}

async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

describe('SurveyCreatePage autosave', () => {
  it('writes nothing for a wizard nobody has typed in', async () => {
    renderPage()
    await settle()
    await tick()

    // Creating the row on mount would leave one behind every time someone opened the
    // wizard and changed their mind, and `/latest` would offer that empty form back.
    expect(draftWrites()).toHaveLength(0)
    // And it must say nothing at all. Rendering the page caught the first version
    // announcing "Not saved yet" on an untouched form, directly under the recovery
    // banner, where it read as a warning about the draft being offered.
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('writes nothing when an untouched wizard is navigated away from', async () => {
    // The unmount flush is a second, separate path into the save: it bypasses the
    // debounce effect entirely, so the emptiness check has to exist on both sides.
    const view = renderPage()
    await settle()

    await act(async () => {
      view.unmount()
    })

    expect(draftWrites()).toHaveLength(0)
  })

  it('flushes an edit made inside the debounce window when the page is left', async () => {
    // Closing the wizard 200ms after the last keystroke is exactly when work goes
    // missing, and it is the case a plain debounce loses.
    const view = renderPage()
    await settle()
    await typeInto(/Title/, 'Quarterly pulse')
    await tick(200)
    expect(draftWrites()).toHaveLength(0)

    await act(async () => {
      view.unmount()
    })

    expect(draftWrites()).toHaveLength(1)
  })

  it('autosaves after an edit and says when it last saved', async () => {
    renderPage()
    await settle()

    await typeInto(/Title/, 'Quarterly pulse')
    await tick()

    const created = draftWrites()[0]
    expect(created.method).toBe('POST')
    expect(created.url).toContain('/surveys/drafts')
    const body = created.body as Record<string, unknown>
    expect(body.title).toBe('Quarterly pulse')
    expect(body.sessionId).toEqual(expect.any(String))
    expect((body.content as Record<string, unknown>).titleEn).toBe('Quarterly pulse')
    expect(screen.getByText(/Draft saved at/)).toBeTruthy()
  })

  it('sends the version guard on the next save, so a second tab cannot be overwritten silently', async () => {
    renderPage()
    await settle()

    await typeInto(/Title/, 'One')
    await tick()
    await typeInto(/Title/, 'One more')
    await tick()

    const writes = draftWrites()
    expect(writes).toHaveLength(2)
    expect(writes[1].url).toContain('/autosave')
    // Version 2 is what the create answered with, not what the client guessed.
    expect((writes[1].body as Record<string, unknown>).expectedVersion).toBe(2)
  })

  it('says so, loudly and stickily, when a save fails', async () => {
    routeFetch({ writeStatus: 500, writeBody: { message: 'Database unavailable' } })
    renderPage()
    await settle()

    await typeInto(/Title/, 'Quarterly pulse')
    await tick()

    // The alert role matters as much as the text: this is the failure mode where the
    // page otherwise looks completely healthy.
    const alert = screen.getByText('Your draft is not being saved').closest('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(screen.getByText('Database unavailable')).toBeTruthy()
    expect(screen.queryByText(/Draft saved at/)).toBeNull()
  })

  it('stops autosaving on a conflict, and only Save anyway resumes it', async () => {
    renderPage()
    await settle()

    await typeInto(/Title/, 'One')
    await tick()
    expect(draftWrites()).toHaveLength(1)

    routeFetch({
      writeStatus: 409,
      writeBody: {
        message: 'This draft has moved on since version 2; it is now at version 7.',
        draft: draftResponse({ version: 7 }),
      },
    })
    await typeInto(/Title/, 'One two')
    await tick()

    const conflicted = draftWrites()
    expect(screen.getByText('This draft changed somewhere else')).toBeTruthy()

    // The point of the guard: further typing must NOT keep hammering the row.
    await typeInto(/Title/, 'One two three')
    await tick()
    expect(draftWrites()).toHaveLength(conflicted.length)

    routeFetch()
    await press('Save anyway')
    await tick()

    const forced = draftWrites().at(-1)!
    // Unconditional on purpose -- the user was told what they are replacing.
    expect((forced.body as Record<string, unknown>).expectedVersion).toBeUndefined()
    expect(screen.getByText(/Draft saved at/)).toBeTruthy()
  })

  it('does not let the unmount flush sneak past an unresolved conflict', async () => {
    // The flush is the one write that does not go through the debounce effect, so the
    // stop that a conflict applies has to be repeated there. Otherwise leaving the page
    // is a back door to the overwrite the user was never asked about.
    const view = renderPage()
    await settle()
    await typeInto(/Title/, 'One')
    await tick()

    routeFetch({
      writeStatus: 409,
      writeBody: {
        message: 'This draft has moved on since version 2; it is now at version 7.',
        draft: draftResponse({ version: 7 }),
      },
    })
    await typeInto(/Title/, 'One two')
    await tick()
    const afterConflict = draftWrites().length

    await act(async () => {
      view.unmount()
    })

    expect(draftWrites()).toHaveLength(afterConflict)
  })

  it('deletes the draft once the survey exists', async () => {
    renderPage()
    await settle()

    await typeInto(/Title/, 'Quarterly pulse')
    await press('Next')
    await typeInto(/Start Date/, '2026-09-01T09:00')
    await typeInto(/End Date/, '2026-09-08T17:00')
    await press('Next')
    await press('Next')
    await press('Add Question')
    await typeInto(/Question Text/, 'What went well?')
    await press('Next')
    await tick()

    await press('Create Survey')
    await tick()

    // `/surveys?lang=en`, not `/surveys` -- createSurvey appends the display locale.
    expect(calls.some((call) => call.method === 'POST' && /\/surveys(\?|$)/.test(call.url))).toBe(
      true,
    )
    // Otherwise the next wizard open offers the finished survey back as unfinished work.
    expect(
      calls.some((call) => call.method === 'DELETE' && call.url.includes('/surveys/drafts/')),
    ).toBe(true)
  })
})

describe('SurveyCreatePage recovery', () => {
  it('offers an unfinished draft back, and restores its values and the step it was left on', async () => {
    routeFetch({
      latest: draftResponse({ currentStep: 4, content: storedContent(), title: 'Recovered pulse' }),
    })
    renderPage()
    await settle()

    expect(screen.getByText('You have an unfinished survey')).toBeTruthy()

    await press('Restore it')
    await settle()

    // Step 4 of 5 is the questions step. Landing back on step 1 is most of the
    // frustration of having lost the work in the first place.
    expect(screen.getByText('Step 4 of 5')).toBeTruthy()
    expect(screen.getByDisplayValue('What went well?')).toBeTruthy()
    expect(calls.some((call) => call.url.includes('/recover'))).toBe(true)
  })

  it('does not offer a draft whose content is from an incompatible version', async () => {
    routeFetch({
      latest: draftResponse({
        content: { ...storedContent(), version: SURVEY_DRAFT_CONTENT_VERSION + 99 },
      }),
    })
    renderPage()
    await settle()

    expect(screen.queryByText('You have an unfinished survey')).toBeNull()
  })

  it('does not offer back a draft that holds nothing', async () => {
    routeFetch({
      latest: draftResponse({
        title: null,
        content: {
          ...storedContent(),
          titleEn: '',
          startDate: '',
          endDate: '',
          questions: [],
        },
      }),
    })
    renderPage()
    await settle()

    expect(screen.queryByText('You have an unfinished survey')).toBeNull()
  })

  it('deletes the offered draft on Discard', async () => {
    routeFetch({ latest: draftResponse({ id: 'draft-9', content: storedContent() }) })
    renderPage()
    await settle()

    await press('Discard it')
    await settle()

    expect(
      calls.some((call) => call.method === 'DELETE' && call.url.includes('/surveys/drafts/draft-9')),
    ).toBe(true)
    expect(screen.queryByText('You have an unfinished survey')).toBeNull()
  })

  it('keeps the draft on Not now', async () => {
    routeFetch({ latest: draftResponse({ id: 'draft-9', content: storedContent() }) })
    renderPage()
    await settle()

    await press('Not now')
    await settle()

    // A moment of indecision must not destroy work. It expires on its own.
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
    expect(screen.queryByText('You have an unfinished survey')).toBeNull()
  })

  it('holds autosave until the offer is answered, so a second draft is not minted beside it', async () => {
    routeFetch({ latest: draftResponse({ id: 'draft-9', content: storedContent() }) })
    renderPage()
    await settle()

    await typeInto(/Title/, 'Something else')
    await tick()

    expect(draftWrites()).toHaveLength(0)
  })
})
