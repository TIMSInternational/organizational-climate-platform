import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import ActionPlanList from './ActionPlanList'
import type { ActionPlan } from '../api/actionPlans'
import { TranslationProvider } from '../../../i18n'

/**
 * The redesigned listing: the **From** column, the past-due marker, and the
 * typographic rule.
 *
 * These render the component the page actually renders. That is worth stating
 * because a test that mounted some other table would stay green no matter how
 * wrong this one got — the failure mode this repository has hit before.
 */
const DEPARTMENTS = new Map([['d1', 'Support']])

function plan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    id: 'p1',
    title: 'Rebalance Support queue ownership',
    companyId: 'c1',
    departmentId: 'd1',
    dueDate: '2026-09-30T00:00:00.000Z',
    status: 'in_progress',
    priority: 'high',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderList(plans: ActionPlan[], departmentNames = DEPARTMENTS, now = new Date(2026, 7, 11)) {
  return render(
    <TranslationProvider>
      <MemoryRouter>
        <ActionPlanList plans={plans} departmentNames={departmentNames} now={now} />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

afterEach(cleanup)

describe('ActionPlanList From column', () => {
  it('names the department the plan was raised for, and links back to it', () => {
    renderList([plan()])

    const from = screen.getByRole('link', { name: /Measured in Support/ })
    expect(from.getAttribute('href')).toBe('/departments')
    expect(within(from).getByText('Support')).toBeTruthy()
  })

  it('says company-wide rather than leaving the cell blank when there is no department', () => {
    // A blank cell reads as missing data. "Company-wide" is the actual answer:
    // `ActionPlan.DepartmentId` is nullable and a plan may legitimately have none.
    renderList([plan({ departmentId: null })])

    expect(screen.getByText('Company-wide')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Measured in/ })).toBeNull()
  })

  it('says the department is not listed rather than borrowing another row name', () => {
    // The departments request is separate and may fail or still be in flight.
    renderList([plan({ departmentId: 'gone' })])

    expect(screen.getByText('Department not listed')).toBeTruthy()
    expect(screen.queryByText('Support')).toBeNull()
  })
})

describe('ActionPlanList due dates', () => {
  it('marks a past-due open plan with a word, not with colour alone', () => {
    renderList([plan({ dueDate: '2026-08-01T00:00:00.000Z' })])

    expect(screen.getByText('Past due')).toBeTruthy()
    // In the ink token, not the identity accent: `text-accent-red` clears 4.5:1
    // on the panel but not on `bg-icon-box` (4.24:1 light, 3.81:1 dark), and one
    // rule for the state words is worth more than one exception in it. Numbers
    // in `styles/accentInkContrast.test.ts`.
    expect(screen.getByText('Past due').className).toContain('text-accent-red-ink')
  })

  it('does not mark a plan due today, nor a completed plan whose date went by', () => {
    renderList([
      plan({ id: 'today', dueDate: '2026-08-11T00:00:00.000Z' }),
      plan({ id: 'done', dueDate: '2020-01-01T00:00:00.000Z', status: 'completed' }),
    ])

    expect(screen.queryByText('Past due')).toBeNull()
  })

  it('sets the due date in mono with tabular figures, and the title in the sans face', () => {
    // The redesign's one typographic rule: readings are mono, prose is not. It is
    // asserted rather than eyeballed because happy-dom does no layout, so nothing
    // else in this suite could ever notice the classes going missing.
    renderList([plan()])

    const date = screen.getByText('9/30/2026')
    expect(date.className).toContain('font-mono')
    expect(date.className).toContain('tabular-nums')

    const title = screen.getByRole('link', { name: 'Rebalance Support queue ownership' })
    expect(title.className).not.toContain('font-mono')
  })
})

describe('ActionPlanList vocabulary', () => {
  it('renders translated status and priority rather than the wire enums', () => {
    renderList([plan({ status: 'not_started', priority: 'critical' })])

    expect(screen.queryByText('not_started')).toBeNull()
    expect(screen.getByText('Not Started')).toBeTruthy()
    expect(screen.getByText('Critical')).toBeTruthy()
  })
})
