import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

/**
 * Vitest's default is 5s, and this file does not fit in it any more.
 *
 * It is the heaviest RTL file in the repository — 25 tests, each rendering the whole
 * wizard page and most of them driving it with `userEvent`, whose Radix `Select`
 * interactions cost a portal open and close apiece. The block header below already
 * records one flake caused by sitting at the 5s edge, and the rail redesign put roughly
 * fifty more elements on every render of this page (five two-line step rows, their state
 * chips, the completion meter and the setup panel), every one of which
 * `getByRole('button', { name })` walks when it computes accessible names.
 *
 * Measured on a machine also running other work: the whole suite passes this file in
 * isolation and cascades under `vitest run` at a load average around 140, where a single
 * timeout inside `act()` leaves React's queue broken and every later test in the file
 * fails behind it. That is a budget problem, not a behaviour one — nothing here is
 * waiting on anything that will not arrive.
 */
vi.setConfig({ testTimeout: 20_000 })

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
  templates?: unknown[]
  templateDetail?: unknown
  templateDetailStatus?: number
  /** Never resolves, so the wizard is observed while the detail is still in flight. */
  templateDetailPending?: boolean
  /** The company's department catalogue. Empty unless a test says otherwise. */
  departments?: unknown[]
  /**
   * Status for `GET /admin/departments`. 500 is a supported state, not a contrived one:
   * `SurveyCreatePage` catches that fetch on purpose ("A failed department list is not a
   * reason to block the flow") and carries on with an empty catalogue.
   */
  departmentsStatus?: number
}

/** A row of `GET /admin/departments`, in the shape `Department` declares. */
function department(id: string, name: string) {
  return {
    id,
    companyId: 'company-1',
    name,
    description: null,
    parentDepartmentId: null,
    isActive: true,
    employeeCount: 12,
  }
}

/** A `SurveyTemplateQuestion`, including the option `value` the wizard must not invent. */
function templateQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tq-1',
    text: 'Which area needs work?',
    type: 'multiple_choice',
    options: [
      { order: 0, value: 'leadership', label: 'Leadership' },
      { order: 1, value: 'tooling', label: 'Tooling' },
    ],
    scaleMin: null,
    scaleMax: null,
    scaleLabelMin: null,
    scaleLabelMax: null,
    required: true,
    commentRequired: false,
    commentPrompt: null,
    order: 0,
    category: 'leadership',
    ...overrides,
  }
}

function templateListItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    name: 'Standard Climate Instrument',
    description: 'The 2026 baseline',
    category: 'general_climate',
    industry: null,
    companySize: null,
    isPublic: true,
    companyId: null,
    isGlobal: true,
    tags: [],
    usageCount: 3,
    rating: 0,
    questionCount: 1,
    lastUsed: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function templateDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...templateListItem(),
    language: 'en',
    resolvedLocale: 'en',
    fallbackFields: [],
    questions: [templateQuestion()],
    sourceSurveyId: null,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
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
      const status = options.departmentsStatus ?? 200
      const body =
        status === 200
          ? { departments: options.departments ?? [] }
          : { message: 'Department list unavailable' }
      return Promise.resolve(new Response(JSON.stringify(body), { status }))
    }
    // Before the `/surveys` POST branch only for readability -- the prefixes differ.
    if (url.includes('/survey-templates/')) {
      if (options.templateDetailPending) return new Promise<Response>(() => {})
      const status = options.templateDetailStatus ?? 200
      const body =
        status === 200
          ? (options.templateDetail ?? templateDetail())
          : { message: 'Template not found' }
      return Promise.resolve(new Response(JSON.stringify(body), { status }))
    }
    if (url.includes('/survey-templates')) {
      return Promise.resolve(
        new Response(JSON.stringify({ templates: options.templates ?? [] }), { status: 200 }),
      )
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

/** The wizard panel while the review step is open. */
function reviewPanel(): HTMLElement {
  return screen
    .getByText('Check it over before it is created.')
    .closest('[data-slot="card"]') as HTMLElement
}

/**
 * A `KpiTile`'s reading: the element straight after the one holding its label.
 *
 * Filtered to the tile's own `<div>` label, because the facts list below the tiles uses
 * some of the same words in a `<dt>` — "Departments" names both the count and the list
 * of names, which are different answers to different questions.
 */
function reading(panel: HTMLElement, label: string): string {
  const tileLabel = within(panel)
    .getAllByText(label)
    .find((node) => node.tagName === 'DIV')
  return tileLabel?.nextElementSibling?.textContent ?? ''
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

  it('reads out what it is about to create, then deletes the draft once it exists', async () => {
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

    // The review step's readings, asserted here rather than in a test of their own:
    // walking the five steps is the most expensive thing in this file, and doing it a
    // second time pushed this block's neighbours past the 5s default timeout under
    // full-suite load. Each of the three is derived rather than typed, and the question
    // count has two possible sources (see `surveyQuestionCount`) of which only one is
    // right in template mode.
    const review = reviewPanel()
    // One question written here, seven days between the two dates, no department chosen.
    expect(reading(review, 'Questions')).toBe('1')
    expect(review.textContent).toContain('Written in this wizard')
    expect(reading(review, 'Days open')).toBe('7')
    expect(reading(review, 'Departments')).toBe('0')
    expect(review.textContent).toContain('Every department')

    // The dates themselves, localised, rather than the machine format the inputs hold.
    expect(screen.queryByText('2026-09-01T09:00')).toBeNull()
    const start = screen.getByText(/Sep 1, 2026/)
    // And set as a reading: mono, tabular. A date is a measurement, a survey type is not.
    expect(start.className).toContain('font-mono')
    expect(start.className).toContain('tabular-nums')
    expect(screen.getByText('Periodic Survey').className).not.toContain('font-mono')

    // The rail's setup panel names no template, because none was chosen. A blank survey
    // showing an empty or "loading" template row would be reporting a mode it is not in.
    const rail = screen.getByRole('navigation', { name: 'Survey creation steps' })
    expect(rail.textContent).toContain('Content language')
    expect(rail.textContent).not.toContain('Template')
    expect(screen.getByText('Blank')).toBeTruthy()

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

/**
 * The DEPARTMENTS reading on the review step.
 *
 * The tile's value is the selection and the sub-line is a ratio, and the two come from
 * different places: `values.departmentIds` is restored verbatim from a draft, while
 * `departments` is a fetch the page catches and carries on without. Neither is a subset
 * of the other by construction, so both of the states below are reachable in the product
 * and both used to produce a reading that cannot be true.
 *
 * A restored draft rather than five `Next` presses: it lands on the review step in one
 * step, and this file's own header records that walking the wizard is the most expensive
 * thing in it.
 */
describe('SurveyCreatePage review departments reading', () => {
  const catalogue = [
    department('dept-1', 'Operations'),
    department('dept-2', 'Support'),
    department('dept-3', 'Engineering'),
  ]

  async function restoreOnReview(options: RouteOptions, departmentIds: string[]) {
    routeFetch({
      ...options,
      latest: draftResponse({
        currentStep: 5,
        content: storedContent({ departmentIds }),
      }),
    })
    renderPage()
    await settle()
    await press('Restore it')
    await settle()
    return reviewPanel()
  }

  it('reads the ratio out only while the catalogue names every selected department', async () => {
    const review = await restoreOnReview({ departments: catalogue }, ['dept-1', 'dept-2'])

    expect(reading(review, 'Departments')).toBe('2')
    expect(review.textContent).toContain('of 3')
    expect(review.textContent).toContain('Operations, Support')
  })

  it('does not read "5 of 3" for a draft naming departments the catalogue does not hold', async () => {
    // `GET /surveys/drafts/latest` is scoped to the user and the expiry window and not
    // to a company (`SurveyDraftEndpoints.Mine`), while the catalogue is fetched for the
    // company context that is current now. Nothing reconciles the two on the way back
    // in, and `MapDepartmentEndpoints` has no delete, so this — not a deletion — is how
    // a selection outruns the list.
    const review = await restoreOnReview({ departments: catalogue }, [
      'dept-1',
      'dept-2',
      'dept-3',
      'dept-gone-1',
      'dept-gone-2',
    ])

    // Five ids are still targeted, so five is the true value; three is not the total of
    // anything the tile is counting.
    expect(reading(review, 'Departments')).toBe('5')
    expect(review.textContent).not.toContain('of 3')
    expect(review.textContent).toContain('Not all are in the department list')
    // The names it does have are still listed -- the caveat is on the tile, not here.
    expect(review.textContent).toContain('Operations, Support, Engineering')
  })

  it('does not read "2 of 0" when the department list failed to load', async () => {
    const review = await restoreOnReview({ departmentsStatus: 500 }, ['dept-1', 'dept-2'])

    expect(reading(review, 'Departments')).toBe('2')
    expect(review.textContent).not.toContain('of 0')
    // Twice: once as the tile's sub-line, once in place of the list of names, which
    // would otherwise fall to an em dash and read as "no departments chosen".
    expect(screen.getAllByText('Not in the department list')).toHaveLength(2)
  })
})

/**
 * Starting from a template (#267).
 *
 * The assertion that matters most is negative: the wizard must NOT post `/surveys` with
 * questions it rebuilt from the template. `SurveyQuestionValues` has no field for
 * `category`, the scale bounds, the comment prompt or an option's `value`, so a round
 * trip through the wizard's editor would silently flatten the instrument — and option
 * `value` is what `SurveyAggregation` calls "THE group key".
 *
 * ## Real timers here, unlike the autosave block above
 *
 * `SelectField` is a Radix `Select` — a button plus a portalled listbox, not a native
 * `<select>` — so `fireEvent.change` does nothing to it and its options are absent from
 * the DOM until it is opened. The only way to drive it is the house pattern
 * (`userEvent.click(combobox)` then click the option), and `userEvent` deadlocks under
 * `vi.useFakeTimers()`. So this block runs on real timers and never asserts on the
 * debounce; the draft's handling of `templateId` is covered in `draftContent.test.ts`,
 * where it is a pure round trip.
 */
describe('SurveyCreatePage template mode', () => {
  beforeEach(() => {
    vi.useRealTimers()
    routeFetch({ templates: [templateListItem()] })
  })

  /** The picker is the second combobox on the basics step; the category filter is first. */
  async function pickTemplate(name = 'Standard Climate Instrument') {
    await userEvent.click(screen.getByRole('combobox', { name: /Start from a template/ }))
    await userEvent.click(await screen.findByRole('option', { name }))
  }

  /**
   * `fireEvent` for the text boxes, `userEvent` only for the Radix Select.
   *
   * `userEvent.type` sends one event per character, so the two datetime fields alone are
   * 32 round trips through React. Under full-suite load that pushed the heaviest test in
   * this block past the 5s default timeout while it passed comfortably in isolation --
   * a flake I introduced and then measured, not one to retry away.
   */
  async function toQuestionsStep() {
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await typeInto(/Start Date/, '2026-09-01T09:00')
    await typeInto(/End Date/, '2026-09-08T17:00')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  }

  it('offers the catalogue and starts blank', async () => {
    renderPage()

    await userEvent.click(screen.getByRole('combobox', { name: /Start from a template/ }))

    expect(await screen.findByRole('option', { name: 'Standard Climate Instrument' })).toBeTruthy()
    // The default has to be the flow that already worked.
    expect(screen.getByRole('option', { name: 'Start blank' }).getAttribute('data-state')).toBe(
      'checked',
    )
  })

  it('seeds the title from the template', async () => {
    renderPage()
    await pickTemplate()

    await waitFor(() =>
      expect((screen.getByLabelText(/Title/) as HTMLInputElement).value).toBe(
        'Standard Climate Instrument',
      ),
    )
  })

  it('does not overwrite a title the author already typed', async () => {
    renderPage()
    await typeInto(/Title/, 'My own name for it')
    await pickTemplate()

    // Browsing templates after naming the survey must not undo the naming.
    //
    // Waiting for the name to appear *twice* is what makes this wait for anything: the
    // picker's own trigger shows it the instant it is chosen, and it is the rail's setup
    // panel — which reads the fetched detail — that marks the render in which a seeded
    // title would have overwritten the typed one.
    await waitFor(() =>
      expect(screen.getAllByText('Standard Climate Instrument').length).toBeGreaterThan(1),
    )
    expect((screen.getByLabelText(/Title/) as HTMLInputElement).value).toBe('My own name for it')
  })

  it('takes the content language from the template and stops offering a choice', async () => {
    routeFetch({
      templates: [templateListItem()],
      templateDetail: templateDetail({ language: 'both' }),
    })
    renderPage()
    await pickTemplate()

    // 'both' propagated, which is why the title splits into two boxes.
    expect(await screen.findByLabelText(/Title \(English\)/)).toBeTruthy()
    expect(screen.getByLabelText(/Title \(Spanish\)/)).toBeTruthy()
    // `/use` takes no language and infers it from the template's questions, so a live
    // control here would be one that silently does nothing.
    expect(
      screen.getByRole('combobox', { name: /Content language/ }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('shows the template questions read-only, with their stable option values', async () => {
    renderPage()
    await pickTemplate()
    await toQuestionsStep()

    expect(await screen.findByText('Which area needs work?')).toBeTruthy()
    // `SurveyQuestionList` renders each option as `label (value)`. The value is the point.
    expect(screen.getByText(/leadership/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add Question' })).toBeNull()
    // "Add at least one" is an instruction with nothing to act on here. Rendering the
    // page caught it still being given.
    expect(screen.queryByText(/Add at least one/)).toBeNull()
    expect(screen.getByText('What the template asks. Copied as it is.')).toBeTruthy()
  })

  it('instantiates server-side and posts no questions of its own', async () => {
    renderPage()
    await pickTemplate()
    await toQuestionsStep()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    // The review reading counts the template's questions, not the wizard's own empty
    // array -- reading that array here reports 0 for a template that has questions in it,
    // and 0 is exactly what a plausible-looking mistake produces. Asserted inside this
    // test rather than in one of its own: walking to review costs ~4s of userEvent, and
    // the block's own header records that doing it twice more pushed its neighbours past
    // the 5s default timeout.
    await screen.findByText('Check it over before it is created.')
    const review = reviewPanel()
    // The template has one question; `values.questions` is empty and always will be in
    // this mode, so a count taken from it reads 0 here and looks entirely plausible.
    expect(reading(review, 'Questions')).toBe('1')
    expect(review.textContent).toContain('From the template')
    expect(review.textContent).not.toContain('Written in this wizard')

    await userEvent.click(await screen.findByRole('button', { name: 'Create Survey' }))

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('/survey-templates/tpl-1/use'))).toBe(true),
    )
    const use = calls.find((call) => call.url.includes('/survey-templates/tpl-1/use'))!
    expect(use.method).toBe('POST')
    const body = use.body as Record<string, unknown>
    expect(body.title).toBe('Standard Climate Instrument')
    expect(body.companyId).toBe('company-1')
    expect(body.startDate).toEqual(expect.any(String))
    // Each of these would be a silent downgrade if the wizard sent it.
    expect(body.questions).toBeUndefined()
    expect(body.language).toBeUndefined()
    // And the blank path must not have run at all.
    expect(calls.some((call) => call.method === 'POST' && /\/surveys(\?|$)/.test(call.url))).toBe(
      false,
    )
  })

  it('refuses to continue past a template with no questions', async () => {
    routeFetch({
      templates: [templateListItem()],
      templateDetail: templateDetail({ questions: [] }),
    })
    renderPage()
    await pickTemplate()
    await toQuestionsStep()

    // Continue reveals the reason rather than moving: the stepper never advances past a
    // step with errors.
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/This template has no questions/)).toBeTruthy()
  })

  it('does not let the questions step pass before the template has arrived', async () => {
    // Otherwise the review step would report "1 question" for a template it has not read,
    // and the author would be told the step is complete before anything is known about it.
    routeFetch({ templates: [templateListItem()], templateDetailPending: true })
    renderPage()
    await pickTemplate()
    // Typed by hand: the title is normally seeded from the template detail, which by
    // design never arrives here, and an empty title would block on the basics step
    // instead -- proving nothing about the questions step.
    await typeInto(/Title/, 'Named before the template loaded')
    await toQuestionsStep()

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText(/Loading the template/)).toBeTruthy()
    // Still on the questions step, not advanced to review.
    expect(screen.queryByRole('button', { name: 'Create Survey' })).toBeNull()
  })

  it('keeps the template and the language visible in the rail once the basics step is left', async () => {
    // Both are decided on step 1 and both change what later steps do -- the template
    // makes the questions step a preview, and a `both` language splits every box in two.
    // Before the rail carried them, neither was checkable from a later step without
    // walking back. One Next is enough to prove it: the basics step is behind us.
    renderPage()
    await pickTemplate()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.queryByLabelText(/Start from a template/)).toBeNull()
    const rail = screen.getByRole('navigation', { name: 'Survey creation steps' })
    expect(rail.textContent).toContain('Standard Climate Instrument')
    expect(rail.textContent).toContain('English')
    // And the mode itself is stated once, at the top, where it decides which endpoint runs.
    expect(screen.getByText('From a template')).toBeTruthy()
  })

  it('says so when the chosen template cannot be loaded', async () => {
    routeFetch({ templates: [templateListItem()], templateDetailStatus: 404 })
    renderPage()
    await pickTemplate()

    // Not silent, unlike the catalogue fetch: a chosen template that failed to load
    // leaves the wizard unable to say what it is about to create.
    expect(await screen.findByText('Template not found')).toBeTruthy()
  })
})
