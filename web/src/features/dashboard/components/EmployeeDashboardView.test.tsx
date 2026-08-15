import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import EmployeeDashboardView from './EmployeeDashboardView'
import { TranslationProvider } from '../../../i18n'
import { setToken } from '../../../auth/token'
import type { EmployeeDashboard, EmployeeLastOutcome } from '../api/dashboard'

/**
 * The employee's Home, rebuilt to the approved design.
 *
 * The view is rendered directly rather than through `DashboardPage`: what is under test
 * here is the *screen*, and `DashboardPage.test.tsx` already proves that an employee is
 * routed to it. Two fetches leave this component on mount — the payload and the
 * "what came of it" panel's own — so the stub below dispatches on the URL rather than
 * answering both with one body.
 */

function payload(overrides: Partial<EmployeeDashboard> = {}): EmployeeDashboard {
  return {
    name: 'Ana',
    companyId: 'c1',
    departmentId: 'd1',
    departmentName: 'Engineering',
    pendingSurveyCount: 1,
    completedSurveyCount: 0,
    unreadNotificationCount: 0,
    nextDeadline: inDays(6),
    pendingSurveys: [pending()],
    ...overrides,
  }
}

/**
 * One pending survey.
 *
 * `anonymous` defaults to **false**, which is `SurveySettings`'s own default and the
 * deliberately awkward choice here: a fixture that made every survey anonymous would draw
 * the chip in nearly every test in this file and leave the case that actually matters — a
 * survey that records who answered — exercised only where somebody thought to ask for it.
 * The tests that are about the chip say which they mean.
 */
function pending(overrides: Partial<EmployeeDashboard['pendingSurveys'][number]> = {}) {
  return {
    id: 's1',
    title: 'Q4 Climate Survey',
    type: 'general_climate',
    startDate: '2026-01-01T00:00:00Z',
    endDate: inDays(6),
    questionCount: 12,
    anonymous: false,
    ...overrides,
  }
}

/** A close date `days` out from whatever "now" currently is, fake clock included. */
function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

/**
 * Answers the two endpoints separately. `outcome` defaults to `null`, the server's own
 * answer for "nothing has closed", which keeps the panel silent in the cases that are not
 * about it.
 */
function serves(dashboard: EmployeeDashboard | null, outcome: EmployeeLastOutcome | null = null): void {
  vi.mocked(fetch).mockImplementation((input) =>
    Promise.resolve(
      new Response(JSON.stringify(String(input).includes('/last-outcome') ? outcome : dashboard), {
        status: 200,
      }),
    ),
  )
}

function renderHome() {
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <EmployeeDashboardView />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/**
 * Every chip on the page, in document order.
 *
 * Read off `data-slot="chip"` rather than by text, so that a chip nobody expected — the
 * "Not anonymous" one, above all — shows up as an extra entry instead of being missed by an
 * assertion that only looked for the words it already knew about.
 */
function chipTexts(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('[data-slot="chip"]')].map((chip) => chip.textContent)
}

/** The three readings on the task card, in order, as `LABEL VALUE` pairs. */
function readings(container: HTMLElement): string[] {
  return [...container.querySelectorAll('dl > div')].map((entry) =>
    [...entry.children].map((node) => node.textContent).join(' '),
  )
}

const AMBIENT_TZ = process.env.TZ

describe('EmployeeDashboardView', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    if (AMBIENT_TZ === undefined) delete process.env.TZ
    else process.env.TZ = AMBIENT_TZ
  })

  /**
   * The redesign's central deletion, and the reason it is a deletion rather than a fix.
   *
   * `SurveyResponseEndpoints.cs:102` stores `IsAnonymous ? null : ActingUserId`, so on an
   * anonymous survey no response row carries a user id and "Surveys you have completed"
   * can only ever read 0 — for somebody who answered. The payload below says exactly that:
   * one survey outstanding, nothing recorded as completed. None of the four tiles may come
   * back, and asserting on the *labels* is what stops one returning under a new number.
   */
  it('cuts the four KPI tiles, including the one that could only ever read zero', async () => {
    serves(payload())
    renderHome()

    await screen.findByRole('heading', { level: 2, name: 'Q4 Climate Survey' })
    for (const label of [
      'Surveys awaiting you',
      'Days until the next closes',
      'Surveys you have completed',
      'Unread notifications',
    ]) {
      expect(screen.queryByText(label), `${label} is back on the employee home`).toBeNull()
    }
  })

  it('leads with the survey to answer and offers one way into it', async () => {
    serves(payload())
    renderHome()

    expect(await screen.findByRole('heading', { level: 2, name: 'Q4 Climate Survey' })).toBeTruthy()
    // `/surveys/:id/respond` is registered and authorised per user by the respond endpoint.
    expect(screen.getByRole('link', { name: 'Start answering' }).getAttribute('href')).toBe(
      '/surveys/s1/respond',
    )
  })

  it('prints the design’s three readings — questions, minutes, closing day', async () => {
    process.env.TZ = 'UTC'
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 6, 9, 0, 0))
    serves(payload())
    const { container } = renderHome()

    await screen.findByRole('heading', { level: 2, name: 'Q4 Climate Survey' })
    // Twelve questions at the design's two-thirds of a minute each is "about 8 min", which
    // is the ratio its own "12 questions · about 8 minutes" states.
    expect(readings(container)).toEqual(['Questions 12', 'About about 8 min', 'Closes Sep 12'])
  })

  it('greets by the reader’s own clock', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // Constructed from local parts, so the hour is 9 in whatever zone the suite runs in
    // and the assertion does not depend on CI's TZ.
    vi.setSystemTime(new Date(2026, 8, 6, 9, 0, 0))
    serves(payload())
    renderHome()

    expect(await screen.findByRole('heading', { level: 1, name: 'Good morning, Ana' })).toBeTruthy()

    cleanup()
    vi.setSystemTime(new Date(2026, 8, 6, 20, 0, 0))
    serves(payload())
    renderHome()

    expect(await screen.findByRole('heading', { level: 1, name: 'Good evening, Ana' })).toBeTruthy()
  })

  /**
   * The deadline, twice, and deliberately in two vocabularies: on the card the reader is
   * deciding whether to start now ("Closes in 6 days"), on a row they are comparing it
   * with the rows around it ("6 days left").
   */
  it('chips the deadline as a sentence on the card and a measurement on the rows', async () => {
    serves(
      payload({
        pendingSurveyCount: 2,
        pendingSurveys: [pending(), pending({ id: 's2', title: 'Weekly pulse', endDate: inDays(3) })],
      }),
    )
    renderHome()

    expect(await screen.findByText('Closes in 6 days')).toBeTruthy()
    expect(screen.getByText('3 days left')).toBeTruthy()
  })

  /**
   * The design leads the task card with the anonymity chip, and the whole employee
   * experience is an argument for that one promise — so it is drawn from the survey's own
   * flag, beside the deadline and before it.
   */
  it('leads the task card with the anonymity chip when the survey is anonymous', async () => {
    serves(payload({ pendingSurveys: [pending({ anonymous: true })] }))
    const { container } = renderHome()

    const chip = await screen.findByText('Anonymous')
    // The word, not only the tint — `Chip` requires a label for WCAG 1.4.1, and an
    // anonymity signal carried by colour alone is exactly what that rule exists to stop.
    expect(chip.getAttribute('data-slot')).toBe('chip')
    // The design's `.task .top` is one row of chips with anonymity first: it is what a
    // respondent decides on before they look at how long they have.
    expect(chipTexts(container)).toEqual(['Anonymous', 'Closes in 6 days'])
  })

  /**
   * The direction that matters, and the reason the gate is not a ternary.
   *
   * `surveyRespond.identifiedChip` ("Not anonymous") exists and the respond page renders it
   * under a heading and a paragraph that explain what is recorded. On a card crossed in two
   * seconds there is no room for that, and the failure modes are not symmetrical: a missing
   * chip understates a real promise, while a chip over a survey that stores `user_id` tells
   * somebody their answers are untraceable when they are not. So `false` draws nothing.
   */
  it('draws no chip at all when the survey is not anonymous, and never “Not anonymous”', async () => {
    serves(payload({ pendingSurveys: [pending({ anonymous: false })] }))
    const { container } = renderHome()

    await screen.findByRole('heading', { level: 2, name: 'Q4 Climate Survey' })
    expect(screen.queryByText('Anonymous'), 'anonymity was promised on a survey that records who answered').toBeNull()
    expect(screen.queryByText('Not anonymous'), 'the negative belongs on the respond page, not on this card').toBeNull()
    // The deadline is still chipped, so this is the chip missing rather than the row.
    expect(chipTexts(container)).toEqual(['Closes in 6 days'])
  })

  /**
   * Silence is not a promise.
   *
   * Not hypothetical: the component is handed parsed JSON, and JSON crosses the boundary
   * unchecked — a server that has not shipped the field, or a cached body from one that had
   * not, sends a survey with no `anonymous` on it at all. The gate compares against `true`
   * rather than testing truthiness precisely so that absence reads as "no claim".
   */
  it('makes no anonymity claim for a payload that carries no anonymity', async () => {
    const survey = pending({ anonymous: true })
    delete (survey as Partial<typeof survey>).anonymous
    serves(payload({ pendingSurveys: [survey] }))
    renderHome()

    await screen.findByRole('heading', { level: 2, name: 'Q4 Climate Survey' })
    expect(screen.queryByText('Anonymous')).toBeNull()
  })

  it('says a survey closes today rather than counting down to a zero', async () => {
    // Already past, which is not "-1 days left". `daysUntil` floors at zero and the copy
    // is the thing that says what zero means.
    serves(payload({ pendingSurveys: [pending({ endDate: inDays(-1) })] }))
    renderHome()

    expect(await screen.findByText('Closes today')).toBeTruthy()
    expect(screen.queryByText('Closes in 0 days')).toBeNull()
  })

  it('follows the leading survey with quieter rows for the rest', async () => {
    serves(
      payload({
        pendingSurveyCount: 2,
        pendingSurveys: [pending(), pending({ id: 's2', title: 'Weekly pulse', endDate: inDays(3) })],
      }),
    )
    renderHome()

    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(1)
    // The second survey is a row, not a second hero: its action is the quiet "Answer".
    expect(within(rows[0]).getByText('Weekly pulse')).toBeTruthy()
    expect(within(rows[0]).getByRole('link', { name: 'Answer' }).getAttribute('href')).toBe(
      '/surveys/s2/respond',
    )
    expect(screen.queryByRole('heading', { level: 2, name: 'Weekly pulse' })).toBeNull()
  })

  /**
   * `DashboardEndpoints.SurveyRowLimit` is 5, so the count is the truth and the list is a
   * page of it. The old view drew the capped table with no hint that anything had been
   * left off, which is the one case where a link to the full list is not redundant.
   */
  it('links to the full list only when more is outstanding than is shown', async () => {
    serves(payload({ pendingSurveyCount: 7 }))
    renderHome()

    expect((await screen.findByRole('link', { name: 'My Surveys' })).getAttribute('href')).toBe(
      '/surveys/my',
    )

    cleanup()
    serves(payload({ pendingSurveyCount: 1 }))
    renderHome()

    await screen.findByRole('heading', { level: 2, name: 'Q4 Climate Survey' })
    expect(screen.queryByRole('link', { name: 'My Surveys' })).toBeNull()
  })

  /**
   * The quiet state, and its one rule: no zeros. The old view answered "nothing is
   * outstanding" with a 0 tile, a — tile, two more zeros and an empty table, which is the
   * same fact spelled as a measurement of nothing.
   */
  it('answers an empty queue in words, naming the department, and draws no zeros', async () => {
    serves(payload({ pendingSurveyCount: 0, pendingSurveys: [], nextDeadline: null }))
    const { container } = renderHome()

    expect(await screen.findByText('Nothing is waiting for you')).toBeTruthy()
    expect(
      screen.getByText(
        'No survey is open to Engineering right now. You will be emailed when the next one opens.',
      ),
    ).toBeTruthy()
    // The greeting's description changes with the state too: nothing is due, so the page
    // is about what happened to the answers already given.
    expect(screen.getByText(/Nothing needs you right now/)).toBeTruthy()
    expect(container.textContent).not.toMatch(/(^|\D)0(\D|$)/)
  })

  it('falls back to the generic empty line for a reader with no department', async () => {
    serves(
      payload({
        departmentId: null,
        departmentName: null,
        pendingSurveyCount: 0,
        pendingSurveys: [],
        nextDeadline: null,
      }),
    )
    renderHome()

    expect(
      await screen.findByText(
        'No survey needs your answer right now. You will be notified when one does.',
      ),
    ).toBeTruthy()
    // And the eyebrow still says where the reader is, rather than going blank.
    expect(screen.getByText('Workspace')).toBeTruthy()
  })

  it('puts the department in the eyebrow and the greeting in the heading', async () => {
    serves(payload())
    renderHome()

    await screen.findByRole('heading', { level: 1 })
    // Not the `h1`: this page is addressed to a person, so the greeting is the heading and
    // the department is the small line above it — the shape every other screen shares.
    expect(screen.getByText('Engineering').tagName).not.toBe('H1')
  })

  /**
   * The panel is mounted as a sibling of the loading band, not inside it, so its request
   * leaves at the same moment the payload's does rather than after it lands.
   *
   * Asserted three ways, because each alone can pass while the intent is broken: the JSX
   * really is there (`src.includes('LastOutcomePanel')` would match this docstring), the
   * second request really is made, and Home really does survive its failure.
   */
  it('mounts the outcome panel, and renders Home when that panel’s own call fails', async () => {
    const source = readFileSync(
      join(process.cwd(), 'src/features/dashboard/components/EmployeeDashboardView.tsx'),
      'utf8',
    )
    expect(source).toMatch(/<LastOutcomePanel/)

    vi.mocked(fetch).mockImplementation((input) =>
      String(input).includes('/last-outcome')
        ? Promise.resolve(new Response(JSON.stringify({ message: 'nope' }), { status: 503 }))
        : Promise.resolve(new Response(JSON.stringify(payload()), { status: 200 })),
    )
    renderHome()

    expect(await screen.findByRole('heading', { level: 2, name: 'Q4 Climate Survey' })).toBeTruthy()
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/last-outcome')),
      ).toBe(true),
    )
    expect(screen.queryByText('Unable to fetch dashboard data')).toBeNull()
  })

  it('shows what came of the last survey underneath the queue', async () => {
    serves(payload(), {
      surveyId: 's3',
      surveyTitle: 'Q3 Climate Survey',
      closedOn: '2026-08-05T00:00:00Z',
      responseCount: 24,
      departmentCount: 5,
      protectedDepartmentCount: 1,
      minimumGroupSize: 5,
      plansOpenedSince: [{ departmentName: 'Engineering', createdAt: '2026-08-21T00:00:00Z' }],
      openPlanCount: 1,
    })
    const { container } = renderHome()

    expect(await screen.findByText('What came of the last one')).toBeTruthy()
    expect(container.textContent).toContain('One department stayed protected')
  })
})
