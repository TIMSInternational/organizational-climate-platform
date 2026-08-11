import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import UserList from './UserList'
import { TranslationProvider, LOCALE_STORAGE_KEY } from '../../../i18n'
import type { User } from '../api/users'

afterEach(() => {
  cleanup()
  localStorage.removeItem(LOCALE_STORAGE_KEY)
})

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'm.herrera@acme.example',
    name: 'Mariana Herrera',
    role: 'company_admin',
    departmentId: 'd1',
    isActive: true,
    lastLoginAt: '2026-08-10T18:04:00Z',
    createdAt: '2025-03-14T09:12:00Z',
    ...overrides,
  }
}

const DEPARTMENTS = [
  { id: 'd1', name: 'Support' },
  { id: 'd2', name: 'Operations' },
]

function renderList(users: User[], locale: 'en' | 'es' = 'en') {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  return render(
    <TranslationProvider>
      <UserList users={users} departments={DEPARTMENTS} onEdit={() => {}} />
    </TranslationProvider>,
  )
}

/** The `<tr>` a given person's name sits in. */
function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name).closest('tr')
  if (!cell) throw new Error(`no row for ${name}`)
  return cell
}

describe('UserList', () => {
  it('translates the role rather than printing the wire token', () => {
    renderList([user({ role: 'company_admin' })])

    const row = rowFor('Mariana Herrera')
    expect(within(row).getByText('Company Admin')).toBeTruthy()
    expect(row.textContent).not.toContain('company_admin')
  })

  it('translates the role into Spanish too', () => {
    renderList([user({ role: 'leader' })], 'es')

    expect(within(rowFor('Mariana Herrera')).getByText('Líder')).toBeTruthy()
  })

  it('prints the server token for a role this build does not know', () => {
    // Better an honestly-foreign word than an invented English one -- and it
    // proves the column is never blank when the API grows a case.
    renderList([user({ role: 'department_admin' })])

    expect(within(rowFor('Mariana Herrera')).getByText('department_admin')).toBeTruthy()
  })

  it('says the status in words, not in colour alone', () => {
    renderList([user({ name: 'Alive One', isActive: true }), user({ id: 'u2', name: 'Gone Two', isActive: false })])

    expect(within(rowFor('Alive One')).getByText('Active')).toBeTruthy()
    expect(within(rowFor('Gone Two')).getByText('Inactive')).toBeTruthy()
  })

  it('names the department, and says Unassigned when there is none', () => {
    renderList([
      user({ name: 'In Support', departmentId: 'd1' }),
      user({ id: 'u2', name: 'Nowhere Yet', departmentId: null }),
    ])

    expect(within(rowFor('In Support')).getByText('Support')).toBeTruthy()
    expect(within(rowFor('Nowhere Yet')).getByText('Unassigned')).toBeTruthy()
  })

  it('says Unassigned rather than a raw id when the department list did not load', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(
      <TranslationProvider>
        <UserList users={[user({ departmentId: 'd9' })]} departments={[]} onEdit={() => {}} />
      </TranslationProvider>,
    )

    const row = rowFor('Mariana Herrera')
    expect(within(row).getByText('Unassigned')).toBeTruthy()
    expect(row.textContent).not.toContain('d9')
  })

  it('says Never for someone who has not signed in, rather than leaving the cell empty', () => {
    renderList([user({ lastLoginAt: null })])

    expect(within(rowFor('Mariana Herrera')).getByText('Never')).toBeTruthy()
  })

  it('sets the readings in mono with tabular figures and leaves the name in the sans face', () => {
    renderList([user()])

    const email = screen.getByText('m.herrera@acme.example')
    expect(email.className).toContain('font-mono')
    expect(email.className).toContain('tabular-nums')

    // The one typographic rule the redesign turns on: a name is prose.
    const name = screen.getByText('Mariana Herrera')
    expect(name.className).not.toContain('font-mono')
  })

  it('renders an empty roster as a message inside the table, not as a missing table', () => {
    renderList([])

    expect(screen.getByText('No users found')).toBeTruthy()
    // Still a table: the column headings stay, so the reader can see what would
    // have been there.
    expect(screen.getByText('Last activity')).toBeTruthy()
  })

  it('shows initials for each person, hidden from assistive technology', () => {
    renderList([user({ name: 'Mariana Herrera' })])

    const initials = screen.getByText('MH')
    expect(initials.getAttribute('aria-hidden')).toBe('true')
  })

  it('offers an edit action per row', async () => {
    const onEdit = vi.fn()
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en')
    render(
      <TranslationProvider>
        <UserList users={[user()]} departments={DEPARTMENTS} onEdit={onEdit} />
      </TranslationProvider>,
    )

    within(rowFor('Mariana Herrera')).getByRole('button', { name: 'Edit' }).click()
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }))
  })
})
