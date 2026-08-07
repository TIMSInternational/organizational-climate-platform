import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider } from '../../i18n'
import AudienceSelector from './AudienceSelector'
import type { AudienceMode } from './audience'
import type { Department } from '../../features/org-structure/api/departments'
import type { User } from '../../features/org-structure/api/users'

afterEach(cleanup)

function user(id: string, departmentId: string | null, isActive = true): User {
  return {
    id,
    email: `${id}@acme.com`,
    name: id,
    role: 'employee',
    departmentId,
    isActive,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

function department(id: string, name: string): Department {
  return {
    id,
    companyId: 'c1',
    name,
    description: null,
    parentDepartmentId: null,
    isActive: true,
    employeeCount: 0,
  }
}

const DEPARTMENTS = [department('eng', 'Engineering'), department('sales', 'Sales')]
const USERS = [user('a', 'eng'), user('b', 'eng'), user('c', 'sales'), user('z', 'eng', false)]

function renderSelector(
  overrides: {
    mode?: AudienceMode
    surveyDepartmentIds?: string[]
    selectedDepartmentIds?: string[]
    selectedUserIds?: string[]
    onModeChange?: () => void
    onDepartmentsChange?: () => void
    onUsersChange?: () => void
  } = {},
) {
  return render(
    <TranslationProvider>
      <AudienceSelector
        mode={overrides.mode ?? 'allTargeted'}
        onModeChange={overrides.onModeChange ?? (() => {})}
        selectedDepartmentIds={overrides.selectedDepartmentIds ?? []}
        onDepartmentsChange={overrides.onDepartmentsChange ?? (() => {})}
        selectedUserIds={overrides.selectedUserIds ?? []}
        onUsersChange={overrides.onUsersChange ?? (() => {})}
        departments={DEPARTMENTS}
        users={USERS}
        surveyDepartmentIds={overrides.surveyDepartmentIds ?? []}
      />
    </TranslationProvider>,
  )
}

describe('AudienceSelector', () => {
  it('previews a count before anything is sent, because sending is not undoable', () => {
    renderSelector()
    expect(screen.getByText('3 people will be invited')).toBeTruthy()
  })

  it('says “everyone in the company” only when the survey targets no department', () => {
    renderSelector()
    expect(screen.getByLabelText('Everyone in the company')).toBeTruthy()

    cleanup()
    renderSelector({ surveyDepartmentIds: ['eng'] })
    expect(screen.getByLabelText('The departments this survey targets')).toBeTruthy()
  })

  it('recounts as the selection changes', () => {
    renderSelector({ mode: 'departments', selectedDepartmentIds: ['eng'] })
    expect(screen.getByText('2 people will be invited')).toBeTruthy()

    cleanup()
    renderSelector({ mode: 'departments', selectedDepartmentIds: ['eng', 'sales'] })
    expect(screen.getByText('3 people will be invited')).toBeTruthy()
  })

  /**
   * The tenancy rule, from the UI side. The lists arrive already scoped to the survey's
   * company; the component has no way to reach any other company's rows and no code path
   * that would widen them. The server enforces the same rule, but a UI that presents an
   * option and then collects a 403 has already disclosed that the option exists.
   */
  it('offers only the departments and people it was handed', async () => {
    renderSelector({ mode: 'departments' })

    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(DEPARTMENTS.length)
    expect(screen.getByText('Engineering')).toBeTruthy()

    cleanup()
    renderSelector({ mode: 'users' })
    // Three, not four: the inactive user is not offered, because the server would drop
    // them and a ticked box that resolves to nobody makes the preview overcount.
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.queryByText('z@acme.com')).toBeNull()
    await userEvent.click(screen.getAllByRole('checkbox')[0])
  })

  it('reports a department toggle to its owner', async () => {
    const onDepartmentsChange = vi.fn()
    renderSelector({ mode: 'departments', onDepartmentsChange })

    await userEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onDepartmentsChange).toHaveBeenCalledWith(['eng'])
  })

  it('untoggles rather than duplicating an already-chosen id', async () => {
    const onUsersChange = vi.fn()
    renderSelector({ mode: 'users', selectedUserIds: ['a'], onUsersChange })

    await userEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onUsersChange).toHaveBeenCalledWith([])
  })

  it('shows a count of zero rather than a stale one when a mode has no selection', () => {
    renderSelector({ mode: 'users', selectedUserIds: [] })
    expect(screen.getByText('0 people will be invited')).toBeTruthy()
  })

  it('lets the mode be changed', async () => {
    const onModeChange = vi.fn()
    renderSelector({ onModeChange })

    await userEvent.click(screen.getByLabelText('Chosen departments'))
    expect(onModeChange).toHaveBeenCalledWith('departments')
  })
})
