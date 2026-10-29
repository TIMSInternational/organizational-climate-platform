import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddPersonForm from './AddPersonForm'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { tokenFor } from '../../../../test/jwtFixture'
import es from '../../../../i18n/es.json'
import type { Department } from '../../api/departments'

const T = es.users.next.add
const COMPANY = '11111111-1111-1111-1111-111111111111'
const BASE = import.meta.env.VITE_API_BASE_URL as string

const DEPARTMENTS: Department[] = [
  { id: 'd1', companyId: COMPANY, name: 'Negocio AP', isActive: true } as Department,
  { id: 'd2', companyId: COMPANY, name: 'Departamento cerrado', isActive: false } as Department,
]

type Call = { url: string; body: { preview: boolean; rows: unknown[]; withCredentials: boolean; newDepartments: string[] } }

/**
 * `POST /admin/users/bulk-import/rows` twice: the preview, then the commit. `onPreview` lets a
 * test refuse the first one, which is how the server reports a duplicate address.
 */
function fetchWith(onPreview?: () => unknown, onCommit?: () => unknown) {
  const calls: Call[] = []
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body)) as Call['body']
    calls.push({ url, body })
    const ok = {
      rows: [{ rowNumber: 1, email: 'nuevo@esph-sa.com', status: 'imported', errors: [], issues: [] }],
      successCount: 1,
      errorCount: 0,
    }
    const answer = body.preview ? (onPreview?.() ?? ok) : (onCommit?.() ?? ok)
    return Promise.resolve(
      new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
  })
  return { mock, calls }
}

function renderForm(onAdded = vi.fn()) {
  render(
    <TranslationProvider>
      <AddPersonForm baseUrl={BASE} companyId={COMPANY} departments={DEPARTMENTS} onAdded={onAdded} />
    </TranslationProvider>,
  )
  return onAdded
}

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(T.name), 'Krissly María Rodríguez')
  await user.type(screen.getByLabelText(T.email), 'nuevo@esph-sa.com')
}

/**
 * Adding ONE person, typed. There is no `POST /admin/users`: this posts a single row through
 * the importer's own route, so the account is shaped exactly as an imported one.
 */
describe('AddPersonForm', () => {
  beforeEach(() => {
    localStorage.clear()
    // The assertions read the Spanish catalogue, which is what this product's users see.
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken(tokenFor({ role: 'company_admin', companyId: COMPANY }))
  })

  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
  })

  it('previews the row, then commits it, and mails nothing', async () => {
    const { mock, calls } = fetchWith()
    vi.stubGlobal('fetch', mock)
    const user = userEvent.setup()
    const onAdded = renderForm()

    await fillIn(user)
    await user.selectOptions(screen.getByLabelText(T.department), 'd1')
    await user.click(screen.getByRole('button', { name: T.submit }))

    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[0].url).toBe(`${BASE}/admin/users/bulk-import/rows`)
    // Preview first, then the write. A commit with no preview is how a duplicate address
    // becomes a 400 with an English sentence instead of a named field.
    expect(calls[0].body.preview).toBe(true)
    expect(calls[1].body.preview).toBe(false)
    // Creating a person is not a reason to email them: who gets mail is decided on
    // Distribución, against a list the client named.
    expect(calls[0].body.withCredentials).toBe(false)
    expect(calls[1].body.withCredentials).toBe(false)
    // The department travels by NAME, which is the importer's column, and no department is
    // created as a side effect of this form.
    expect(calls[1].body.rows).toEqual([
      { rowNumber: 1, name: 'Krissly María Rodríguez', email: 'nuevo@esph-sa.com', role: 'employee', department: 'Negocio AP' },
    ])
    expect(calls[1].body.newDepartments).toEqual([])
    expect(onAdded).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(T.added.replace('{name}', 'Krissly María Rodríguez'))).toBeTruthy()
  })

  it('says the server refusal in Spanish and does not write the row', async () => {
    const { mock, calls } = fetchWith(() => ({
      rows: [
        {
          rowNumber: 1,
          email: 'nuevo@esph-sa.com',
          status: 'error',
          errors: ['A user with this email already exists.'],
          issues: [{ code: 'already_user' }],
        },
      ],
      successCount: 0,
      errorCount: 1,
    }))
    vi.stubGlobal('fetch', mock)
    const user = userEvent.setup()
    const onAdded = renderForm()

    await fillIn(user)
    await user.click(screen.getByRole('button', { name: T.submit }))

    expect(await screen.findByText(es.users.intake.reason.already_user)).toBeTruthy()
    // The English the server sent is not what the reader gets.
    expect(screen.queryByText('A user with this email already exists.')).toBeNull()
    // Refused at the preview, so nothing was written and the roster was not reloaded.
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].body.preview).toBe(true)
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('offers only active departments, plus none', () => {
    vi.stubGlobal('fetch', fetchWith().mock)
    renderForm()

    const options = Array.from((screen.getByLabelText(T.department) as HTMLSelectElement).options).map((o) => o.textContent)
    expect(options).toEqual([T.noDepartment, 'Negocio AP'])
  })

  it('states on the form that no email goes out', () => {
    vi.stubGlobal('fetch', fetchWith().mock)
    renderForm()

    expect(screen.getByText(T.sendsNothing)).toBeTruthy()
  })
})
