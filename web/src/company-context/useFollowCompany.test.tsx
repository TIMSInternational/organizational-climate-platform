import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { clearToken, setToken } from '../auth/token'
import { tokenFor } from '../test/jwtFixture'
import { COMPANY_CONTEXT_STORAGE_KEY, CompanyContextProvider, useCompanyContext } from '.'
import { useFollowCompany } from './useFollowCompany'

function Probe({ companyId }: { companyId: string | undefined }) {
  useFollowCompany(companyId)
  const { selectedCompanyId, scope } = useCompanyContext()
  return <p data-testid="probe">{`${selectedCompanyId ?? 'none'}|${scope.companyId ?? 'none'}`}</p>
}

function renderAs(role: string, claimCompany: string, follow: string | undefined) {
  setToken(tokenFor({ role, companyId: claimCompany, sub: 'u1', name: 'Ana' }))
  return render(
    <CompanyContextProvider>
      <Probe companyId={follow} />
    </CompanyContextProvider>,
  )
}

afterEach(() => {
  cleanup()
  clearToken()
  localStorage.removeItem(COMPANY_CONTEXT_STORAGE_KEY)
})

describe('useFollowCompany', () => {
  it("moves a super admin's header from another company to the opened record's company, and remembers it", async () => {
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'other-client')
    renderAs('super_admin', '', 'esph')
    expect((await screen.findByText('esph|esph')).textContent).toBe('esph|esph')
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBe('esph')
  })

  it('selects the company for a super admin who had none selected', async () => {
    renderAs('super_admin', '', 'esph')
    expect(await screen.findByText('esph|esph')).toBeTruthy()
  })

  it('does nothing while the record is still loading', () => {
    localStorage.setItem(COMPANY_CONTEXT_STORAGE_KEY, 'other-client')
    renderAs('super_admin', '', undefined)
    expect(screen.getByTestId('probe').textContent).toBe('other-client|other-client')
  })

  it("never touches a company admin's scope, which is their claim", () => {
    renderAs('company_admin', 'c1', 'c2')
    expect(screen.getByTestId('probe').textContent).toBe('none|c1')
    expect(localStorage.getItem(COMPANY_CONTEXT_STORAGE_KEY)).toBeNull()
  })
})
