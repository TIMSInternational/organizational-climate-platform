import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LOCALE_STORAGE_KEY, TranslationProvider } from '../../../../i18n'
import { clearToken, setToken } from '../../../../auth/token'
import { CompanyContextProvider } from '../../../../company-context'
import { tokenFor } from '../../../../test/jwtFixture'
import es from '../../../../i18n/es.json'
import DeleteCompanyCard from './DeleteCompanyCard'
import type { CompanyDeletionAssessment } from '../../api/companies'

const D = es.superadmin.next.companyDetail.delete
const COMPANY = '33333333-3333-3333-3333-333333333333'

function assessment(over: Partial<CompanyDeletionAssessment> = {}): CompanyDeletionAssessment {
  return {
    id: COMPANY, name: 'ESPH Ensayo 2', domain: 'ensayo.test', deletable: true,
    responses: 0, answeredMicroclimates: 0, linkParticipations: 0, superAdmins: 0,
    people: 12, surveys: 2, departments: 3,
    ...over,
  }
}

function stubFetch(found: CompanyDeletionAssessment, deleteStatus = 204, deleteBody: unknown = null) {
  const sent: { method: string; url: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      sent.push({ method, url: String(input), body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null })
      if (method === 'DELETE') {
        return Promise.resolve(
          deleteStatus === 204
            ? new Response(null, { status: 204 })
            : new Response(JSON.stringify(deleteBody), { status: deleteStatus, headers: { 'Content-Type': 'application/json' } }),
        )
      }
      return Promise.resolve(new Response(JSON.stringify(found), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }),
  )
  return sent
}

function renderCard() {
  render(
    <TranslationProvider>
      <CompanyContextProvider>
        <MemoryRouter initialEntries={[`/admin/companies/${COMPANY}`]}>
          <Routes>
            <Route path="/admin/companies/:id" element={<DeleteCompanyCard companyId={COMPANY} companyName="ESPH Ensayo 2" />} />
            <Route path="/admin/companies" element={<p data-testid="companies-list">list</p>} />
          </Routes>
        </MemoryRouter>
      </CompanyContextProvider>
    </TranslationProvider>,
  )
}

/** «Eliminar empresa» (ruled 2026-11-08): a company nobody has answered anything in, from the screen. */
describe('Deleting a company', () => {
  beforeEach(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es')
    setToken(tokenFor({ role: 'super_admin' }))
  })
  afterEach(() => {
    cleanup()
    clearToken()
    vi.unstubAllGlobals()
  })

  it('says what goes, needs the name typed exactly, then deletes and returns to the list', async () => {
    const sent = stubFetch(assessment())
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: D.action }))
    const dialog = await screen.findByRole('dialog')
    expect((await within(dialog).findByTestId('delete-company-scope')).textContent).toBe(
      D.scope.replace('{people}', '12').replace('{surveys}', '2').replace('{departments}', '3'),
    )
    const confirm = within(dialog).getByRole('button', { name: D.confirm })
    expect(confirm.hasAttribute('disabled')).toBe(true)

    const field = within(dialog).getByLabelText(D.typeName.replace('{company}', 'ESPH Ensayo 2'))
    await user.type(field, 'ESPH Ensayo')
    expect(confirm.hasAttribute('disabled')).toBe(true)
    await user.type(field, ' 2')
    await user.click(confirm)

    expect(sent.filter((s) => s.method === 'DELETE')).toEqual([
      { method: 'DELETE', url: expect.stringMatching(new RegExp(`/admin/companies/${COMPANY}$`)) as unknown as string, body: { confirmName: 'ESPH Ensayo 2' } },
    ])
    expect(await screen.findByTestId('companies-list')).toBeTruthy()
  })

  it('refuses a company with answers and offers nothing to confirm', async () => {
    stubFetch(assessment({ deletable: false, responses: 239 }))
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: D.action }))
    const dialog = await screen.findByRole('dialog')

    expect((await within(dialog).findByTestId('delete-company-refused')).textContent).toBe(D.refusedAnswers.replace('{count}', '239'))
    expect(within(dialog).queryByRole('button', { name: D.confirm })).toBeNull()
    expect(within(dialog).queryByRole('textbox')).toBeNull()
  })

  it('refuses a company that holds a TIMS operator', async () => {
    stubFetch(assessment({ deletable: false, superAdmins: 1 }))
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: D.action }))

    expect((await screen.findByTestId('delete-company-refused')).textContent).toBe(D.refusedSuperAdmins.replace('{count}', '1'))
  })

  it('says a server refusal in Spanish and stays put', async () => {
    stubFetch(assessment(), 409, { code: 'company_people_referenced', message: 'English' })
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: D.action }))
    const dialog = await screen.findByRole('dialog')
    await user.type(await within(dialog).findByLabelText(D.typeName.replace('{company}', 'ESPH Ensayo 2')), 'ESPH Ensayo 2')
    await user.click(within(dialog).getByRole('button', { name: D.confirm }))

    expect(await within(dialog).findByText(es.errors.api.codes.company_people_referenced)).toBeTruthy()
    expect(screen.queryByTestId('companies-list')).toBeNull()
  })
})
