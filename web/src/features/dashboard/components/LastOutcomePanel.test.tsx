import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import LastOutcomePanel from './LastOutcomePanel'
import { TranslationProvider } from '../../../i18n'
import { setToken } from '../../../auth/token'
import type { EmployeeLastOutcome } from '../api/dashboard'

/**
 * "What came of the last one" — the panel that answers the question anonymity leaves open.
 *
 * Three properties are worth defending here, and nothing else in the suite defends them:
 *
 * 1. **It never names a protected department**, in either of the two places it could —
 *    the clause under the closed row, and the list of departments a plan was opened in.
 *    `i18n/employeeCopy.test.ts` holds the *strings* to that rule; this holds the code.
 * 2. **It fails silent.** It is supplementary content on a page whose real job is the
 *    survey someone owes an answer to, so a refusal draws nothing rather than an error.
 * 3. **It prints no zero.** The endpoint's own remark is that the panel is *absent, not
 *    empty*, and "0 of them are still open" is the shape that argument rules out.
 */

function outcome(overrides: Partial<EmployeeLastOutcome> = {}): EmployeeLastOutcome {
  return {
    surveyId: 's3',
    surveyTitle: 'Q3 Climate Survey',
    closedOn: '2026-08-05T00:00:00Z',
    responseCount: 24,
    departmentCount: 5,
    protectedDepartmentCount: 0,
    minimumGroupSize: 5,
    plansOpenedSince: [
      { departmentName: 'Engineering', createdAt: '2026-08-21T00:00:00Z' },
      { departmentName: 'Operations', createdAt: '2026-08-24T00:00:00Z' },
    ],
    openPlanCount: 2,
    ...overrides,
  }
}

/** The endpoint answers `null` at 200 for "nothing has closed" — see `getEmployeeLastOutcome`. */
function serves(body: EmployeeLastOutcome | null, status = 200): void {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

function renderPanel() {
  return render(
    <TranslationProvider>
      <LastOutcomePanel />
    </TranslationProvider>,
  )
}

/** The ambient zone, so the case that sets its own can put it back. */
const AMBIENT_TZ = process.env.TZ

describe('LastOutcomePanel', () => {
  beforeEach(() => {
    setToken('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    if (AMBIENT_TZ === undefined) delete process.env.TZ
    else process.env.TZ = AMBIENT_TZ
  })

  it('asks its own endpoint, in the reader’s language', async () => {
    serves(outcome())
    renderPanel()

    expect(await screen.findByText('Q3 Climate Survey closed')).toBeTruthy()
    const [url] = vi.mocked(fetch).mock.calls[0] as [string]
    // The survey title is authored content, resolved server-side per language, so the
    // locale travels with the request exactly as it does on `/dashboard/employee`.
    expect(url).toContain('/dashboard/employee/last-outcome')
    expect(url).toContain('lang=en')
  })

  it('reports how many answered and across how many departments, both in mono', async () => {
    serves(outcome())
    const { container } = renderPanel()

    await screen.findByText('Q3 Climate Survey closed')
    expect(container.textContent).toContain('24 answers across 5 departments.')
    // The typographic thesis: every reading is mono with tabular figures, the prose is not.
    // A flat `t()` would render both figures in the sans face and still read correctly.
    expect(
      [...container.querySelectorAll('.font-mono.tabular-nums')].map((node) => node.textContent),
    ).toEqual(['24', '5', '2', '2'])
  })

  it('counts a protected department and never names one', async () => {
    // The plan list is where a name could leak back in: one plan's department is withheld
    // (null, indistinguishable from a company-wide plan) and one is not.
    serves(
      outcome({
        protectedDepartmentCount: 1,
        plansOpenedSince: [
          { departmentName: null, createdAt: '2026-08-21T00:00:00Z' },
          { departmentName: 'Engineering', createdAt: '2026-08-24T00:00:00Z' },
        ],
      }),
    )
    const { container } = renderPanel()

    await screen.findByText('Q3 Climate Survey closed')
    expect(container.textContent).toContain(
      'One department stayed protected — fewer than 5 answered there',
    )
    // The nameless plan contributes no name at all — not an empty slot, not a placeholder.
    // Vacuity control on the line above: the panel demonstrably CAN print a department
    // name, so "Finance is not here" is a fact about this code rather than about the copy.
    expect(container.textContent).toContain('In Engineering.')
    expect(container.textContent).not.toContain('In Engineering and')
  })

  it('says "departments" in the plural only when more than one was withheld', async () => {
    serves(outcome({ protectedDepartmentCount: 3 }))
    const { container } = renderPanel()

    await screen.findByText('Q3 Climate Survey closed')
    expect(container.textContent).toContain('3 departments stayed protected — fewer than 5')
    expect(container.textContent).not.toContain('One department stayed protected')
  })

  it('leaves the protected clause off entirely when nothing was withheld', async () => {
    serves(outcome({ protectedDepartmentCount: 0 }))
    const { container } = renderPanel()

    await screen.findByText('Q3 Climate Survey closed')
    expect(container.textContent).not.toContain('stayed protected')
  })

  it('joins the departments in the reader’s language, and never names one twice', async () => {
    serves(
      outcome({
        plansOpenedSince: [
          { departmentName: 'Engineering', createdAt: '2026-08-21T00:00:00Z' },
          { departmentName: 'Engineering', createdAt: '2026-08-22T00:00:00Z' },
          { departmentName: 'Operations', createdAt: '2026-08-24T00:00:00Z' },
        ],
        openPlanCount: 3,
      }),
    )
    const { container } = renderPanel()

    await screen.findByText('Q3 Climate Survey closed')
    // `Intl.ListFormat`, not `join(', ')` — and de-duplicated, because two plans in one
    // department would otherwise read "In Engineering, Engineering, and Operations".
    expect(container.textContent).toContain('In Engineering and Operations.')
  })

  it('says how many plans are still open, and marks the row as open rather than dating it', async () => {
    serves(outcome())
    const { container } = renderPanel()

    await screen.findByText('Q3 Climate Survey closed')
    expect(container.textContent).toContain('2 of them are still open')
    expect(container.textContent).toContain('Your leaders can see that too.')
    // "Open" is a state, not a date, so it is not marked up as one.
    expect(screen.getByText('Open').tagName).not.toBe('TIME')
  })

  it('drops the still-open row rather than printing a zero under an empty set', async () => {
    serves(outcome({ plansOpenedSince: [], openPlanCount: 0 }))
    const { container } = renderPanel()

    await screen.findByText('Q3 Climate Survey closed')
    expect(container.textContent).toContain('No action plans have been opened since.')
    expect(container.textContent).not.toContain('still open')
    // No zero anywhere: "0 of them are still open" beneath "none have been opened" is a
    // measurement of a set the reader was just told is empty.
    expect(container.textContent).not.toMatch(/(^|\D)0(\D|$)/)
  })

  it('draws nothing at all when the company has never closed a survey', async () => {
    // Four bytes of valid JSON at 200. Not a 404, and not a zero-filled payload that
    // would render "0 answers across 0 departments" about a survey that never happened.
    serves(null)
    const { container } = renderPanel()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(screen.queryByText('What came of the last one')).toBeNull()
  })

  it('draws nothing at all when the request is refused, and reports no error', async () => {
    // The panel is supplementary. Home's real job is the survey somebody owes an answer
    // to, and a failure here must not put an error block on that page.
    serves(null, 503)
    const { container } = renderPanel()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('prints the closing day as the calendar day it is, west of UTC', async () => {
    // `closedOn` is a UTC midnight standing for a calendar day. Read in the browser's own
    // zone it slides to the day before everywhere west of UTC — the bug `calendarDay`
    // exists for. Set explicitly, because in UTC the assertion would hold either way.
    process.env.TZ = 'America/Chicago'
    serves(outcome())
    renderPanel()

    await screen.findByText('Q3 Climate Survey closed')
    expect(screen.getByText('Aug 5')).toBeTruthy()
  })
})
