import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../i18n'
import { setToken, clearToken } from '../../auth/token'
import { ShellControls } from './ShellControls'
import { tokenFor } from '../../test/jwtFixture'
import es from '../../i18n/es.json'

afterEach(() => {
  cleanup()
  clearToken()
})

function renderControls() {
  render(
    <TranslationProvider initialLocale="es">
      <MemoryRouter>
        <ShellControls onSignOut={() => {}} />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/**
 * The mobile drawer's user block, which had no test file at all until 2026-10-16.
 *
 * That gap is the reason the "no name reaches a respondent" handoff listed six places and
 * there were seven: this component renders the signed-in person's name exactly as
 * `SidebarUserMenu` does (`AdminLayout.tsx` passes it to `MobileNav`'s footer), and it is
 * the one most of ESPH's 640 people will actually see, because they answer on a phone.
 *
 * `auth/ownName.ts` is the single rule both shells read. `ownName.test.ts` pins the
 * predicate; these assert this caller reads it, which is the half a test of the rule alone
 * cannot see.
 */
describe('ShellControls, the mobile drawer’s user block', () => {
  it('does not show a respondent their own name, and shows no initial either', () => {
    setToken(tokenFor({ name: 'Ángela Hernández', role: 'employee', companyId: 'c1' }))
    renderControls()

    expect(screen.queryByText('Ángela Hernández')).toBeNull()
    expect(screen.queryByText('Á')).toBeNull()
    // The block stays, carrying the role — which names no person — and the label.
    expect(screen.getByText(es.shell.account)).toBeTruthy()
    expect(screen.getByText(es.users.employee)).toBeTruthy()
  })

  it('fails closed for a role it does not recognise and for no role at all', () => {
    setToken(tokenFor({ name: 'Ángela Hernández', role: 'auditor_externo', companyId: 'c1' }))
    renderControls()
    expect(screen.queryByText('Ángela Hernández')).toBeNull()

    cleanup()
    setToken(tokenFor({ name: 'Ángela Hernández', companyId: 'c1' }))
    renderControls()
    expect(screen.queryByText('Ángela Hernández')).toBeNull()
  })

  it('still shows an administrator their own name and initial', () => {
    setToken(tokenFor({ name: 'Ana Rojas', role: 'company_admin', companyId: 'c1' }))
    renderControls()

    expect(screen.getByText('Ana Rojas')).toBeTruthy()
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.getByText(es.users.companyAdmin)).toBeTruthy()
  })

  it('renders no user block at all when there is neither a name to show nor a known role', () => {
    // The guard this replaced was `if (!name) return null`, which would now swallow the
    // whole block for every respondent. It is `!name && !roleKey` for that reason, so this
    // asserts the only case that should still vanish: nothing to say.
    setToken(tokenFor({ companyId: 'c1' }))
    renderControls()

    expect(screen.queryByText(es.shell.account)).toBeNull()
    // The controls below it are untouched — this is a missing block, not a broken drawer.
    expect(screen.getByText(es.shell.signOut)).toBeTruthy()
  })
})
