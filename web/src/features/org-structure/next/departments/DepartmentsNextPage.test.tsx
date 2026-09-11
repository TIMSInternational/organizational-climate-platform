import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../../i18n'
import { setToken, clearToken } from '../../../../auth/token'
import { CompanyContextProvider, COMPANY_CONTEXT_STORAGE_KEY } from '../../../../company-context'
import { clearCompanyNameCache } from '../../../../company-context/useCompanyName'
import { tokenFor } from '../../../../test/jwtFixture'
import { listDepartments, type Department } from '../../api/departments'
import { listUsers, type User } from '../../api/users'
import { listActionPlans, type ActionPlan } from '../../../action-plans/api/actionPlans'
import { getClimateTrends, type ClimateTrendsResponse } from '../../../surveys/api/climateTrends'
import DepartmentsNextPage from './DepartmentsNextPage'
import en from '../../../../i18n/en.json'

const copy = en.departments.next

vi.mock('../../api/departments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/departments')>()),
  listDepartments: vi.fn(),
}))
vi.mock('../../api/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/users')>()),
  listUsers: vi.fn(),
}))
vi.mock('../../../action-plans/api/actionPlans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../action-plans/api/actionPlans')>()),
  listActionPlans: vi.fn(),
}))
vi.mock('../../../surveys/api/climateTrends', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../surveys/api/climateTrends')>()),
  getClimateTrends: vi.fn(),
}))

const dept = (id: string, name: string, employeeCount: number, isActive = true): Department => ({
  id, companyId: 'c1', name, description: null, parentDepartmentId: null, isActive, employeeCount,
})
const user = (name: string, role: string, departmentId: string): User => ({
  id: name, email: `${name}@x.test`, name, role, departmentId, isActive: true, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z',
})
const plan = (departmentId: string, status: string, dueDate: string): ActionPlan => ({
  id: `${departmentId}-${status}`, title: 'P', companyId: 'c1', departmentId, dueDate, status, priority: 'high', createdAt: '2026-01-01T00:00:00Z',
})
const point = (respondentCount: number, isSuppressed: boolean, scores: (number | null)[]) => ({ surveyId: 'q3', respondentCount, isSuppressed, scores })

/** Meridiano's shape: the server zeroes a suppressed group's count (Finanzas, measured 10 Sep). */
const trends: ClimateTrendsResponse = {
  companyId: 'c1',
  groupBy: 'department',
  surveys: [{ surveyId: 'q3', title: 'Encuesta de Clima Q3', status: 'closed', endDate: '2026-08-06T00:00:00Z', completedCount: 24, isSuppressed: false }],
  dimensions: [{ key: 'trust', surveyCount: 1 }, { key: 'workload', surveyCount: 1 }],
  groups: [
    { key: 'fin', label: 'Finanzas', points: [point(0, true, [null, null])] },
    { key: 'ops', label: 'Operaciones', points: [point(5, false, [3.2, 2.4])] },
    { key: 'ing', label: 'Ingeniería', points: [point(7, true, [4.4, 4.4])] },
    { key: 'ven', label: 'Ventas', points: [point(3, false, [4.1, 4.1])] },
  ],
  suppressedGroupCount: 2,
  minimumGroupSize: 5,
  generatedAt: '2026-09-10T00:00:00Z',
}

function renderAs(claims: Record<string, unknown>) {
  setToken(tokenFor({ sub: 'u1', nodoId: '', ...claims }))
  return render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={['/departments']}>
          <DepartmentsNextPage />
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

const rowOf = (name: string) => document.querySelector(`tr[data-department-row="${name}"]`) as HTMLElement | null
const cardOf = (name: string) => document.querySelector(`li[data-department="${name}"]`) as HTMLElement

describe('DepartmentsNextPage (/departments)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.localStorage.setItem('preferredLocale', 'en')
    vi.mocked(listDepartments).mockReset().mockResolvedValue([
      dept('fin', 'Finanzas', 6), dept('ing', 'Ingeniería', 14), dept('ops', 'Operaciones', 7), dept('ven', 'Ventas', 7), dept('cal', 'Calidad 18', 0, false),
    ])
    vi.mocked(listUsers).mockReset().mockResolvedValue([user('Carla', 'leader', 'fin'), user('Sofía', 'supervisor', 'ing')])
    vi.mocked(listActionPlans).mockReset().mockResolvedValue([
      plan('ops', 'not_started', '2099-10-15T00:00:00Z'),
      plan('fin', 'in_progress', '2020-01-01T00:00:00Z'),
      plan('ven', 'cancelled', '2020-01-01T00:00:00Z'),
      // Past due but done: a closed plan is not open, so it is neither counted nor overdue.
      plan('fin', 'completed', '2020-01-01T00:00:00Z'),
      plan('ing', 'completed', '2020-01-01T00:00:00Z'),
    ])
    vi.mocked(getClimateTrends).mockReset().mockResolvedValue(trends)
  })
  afterEach(() => {
    cleanup()
    clearToken()
    clearCompanyNameCache()
    window.localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
  })

  it('prints "protected" and no number for a group the server suppressed, even when it sends a count at or over the floor', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    const row = await screen.findByText('Ingeniería', { selector: 'td' })
    const cells = row.closest('tr')!.querySelectorAll('td')
    expect(cells[4].textContent).toBe(copy.protected)
    expect(cardOf('Ingeniería').textContent).not.toMatch(/4[.,]4/)
  })

  it('re-applies the floor itself: a group under 5 the server did not flag is protected too', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByText('Ventas', { selector: 'td' })
    expect(rowOf('Ventas')!.querySelectorAll('td')[4].textContent).toBe(copy.protected)
    expect(rowOf('Ventas')!.textContent).not.toMatch(/4[.,]1/)
    expect(cardOf('Ventas').textContent).toContain('Protected in Q3')
  })

  it('reads a disclosed group as the mean of its dimensions, names the target when under it, and the lowest dimension on the card', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByText('Operaciones', { selector: 'td' })
    expect(rowOf('Operaciones')!.querySelectorAll('td')[4].textContent).toBe('2.8· below the 3.7 target')
    expect(cardOf('Operaciones').textContent).toContain('Workload 2.4 in Q3')
  })

  it('counts plans per department: overdue in red words, not started in amber, a closed plan not at all', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByText('Finanzas', { selector: 'td' })
    expect(rowOf('Finanzas')!.querySelectorAll('td')[3].textContent).toBe('1 · 1 overdue')
    expect(rowOf('Operaciones')!.querySelectorAll('td')[3].textContent).toBe('1 · not started')
    expect(rowOf('Ventas')!.querySelectorAll('td')[3].textContent).toBe('—')
    // Ingeniería's only plan is completed and long past due: no open plan, nothing overdue.
    expect(rowOf('Ingeniería')!.querySelectorAll('td')[3].textContent).toBe('—')
    expect(screen.getByText('1 overdue · Finanzas')).toBeTruthy()
  })

  it('keeps inactive departments behind the toggle', async () => {
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByText('Finanzas', { selector: 'td' })
    expect(rowOf('Calidad 18')).toBeNull()
    await userEvent.click(screen.getByRole('switch'))
    expect(rowOf('Calidad 18')).not.toBeNull()
  })

  it('surfaces the bulk import on the users page, and prints a dash — not "no leader" — when the users read failed', async () => {
    vi.mocked(listUsers).mockRejectedValue(new Error('boom'))
    renderAs({ role: 'company_admin', companyId: 'c1' })
    await screen.findByText('Finanzas', { selector: 'td' })
    expect(screen.getByRole('link', { name: copy.importPeople }).getAttribute('href')).toBe('/admin/companies/c1/users?import=1')
    expect(rowOf('Finanzas')!.querySelectorAll('td')[2].textContent).toBe('—')
    // The org chart's card reads the same absence the same way: its Líder line is a dash too.
    expect(cardOf('Finanzas').querySelector('dd')!.textContent).toBe('—')
  })

  it('offers a leader nothing and asks for nothing: /admin/departments is admin-only', async () => {
    renderAs({ role: 'leader', companyId: 'c1' })
    expect(await screen.findByText(copy.notAllowedTitle)).toBeTruthy()
    expect(vi.mocked(listDepartments)).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: copy.importPeople })).toBeNull()
  })
})
