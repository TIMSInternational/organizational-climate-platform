import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../i18n'
import { setToken, clearToken } from '../../auth/token'
import { SidebarUserMenu } from './SidebarUserMenu'
import { tokenFor } from '../../test/jwtFixture'

afterEach(() => {
  cleanup()
  clearToken()
})

function renderMenu() {
  render(
    <TranslationProvider>
      <MemoryRouter>
        <SidebarUserMenu onSignOut={() => {}} />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/**
 * req(#384, the gap it names): this component and `ShellControls` are the two places that
 * render the signed-in user's name and take `charAt(0)` of it for the avatar initial --
 * the exact user-visible symptom of #375, where a mangled `Ángela` put a literal `Ã` in
 * the avatar circle. Neither had a test file at all, and `AdminLayout.test.tsx` never set
 * a `name` claim, so that symptom was covered only by decoder unit tests plus a
 * screenshot somebody had to read.
 *
 * These assert the symptom itself, on the rendered DOM, through a fixture built the way a
 * real token is. They fail against the pre-#382 decoder and against any future fixture
 * that reaches back for `btoa`.
 */
describe('SidebarUserMenu, accented names', () => {
  it('renders an accented name intact rather than mojibake', () => {
    setToken(tokenFor({ name: 'Ángela Hernández', role: 'company_admin', companyId: 'c1' }))
    renderMenu()

    expect(screen.getByText('Ángela Hernández')).toBeTruthy()
    // The specific corruption #375 produced. Asserting its absence by name is worth more
    // than asserting the happy string alone, because it names what regressed.
    expect(screen.queryByText(/Ã/)).toBeNull()
  })

  it('takes the accented letter itself as the avatar initial, not its first byte', () => {
    setToken(tokenFor({ name: 'Ángela Hernández', role: 'company_admin', companyId: 'c1' }))
    renderMenu()

    // `Á` is U+00C1: one character, two UTF-8 bytes. A Latin-1 round trip yields `Ã`
    // here, which is precisely what appeared in the avatar circle.
    expect(screen.getByText('Á')).toBeTruthy()
  })

  it('uppercases a lowercase accented initial without mangling it', () => {
    setToken(tokenFor({ name: 'ángela', role: 'employee', companyId: 'c1' }))
    renderMenu()

    expect(screen.getByText('Á')).toBeTruthy()
  })

  it('falls back to a question mark when there is no name claim at all', () => {
    setToken(tokenFor({ role: 'employee', companyId: 'c1' }))
    renderMenu()

    // Guards the `?? '?'` branch, so the accented cases above cannot pass merely because
    // the component renders a placeholder for everything.
    expect(screen.getByText('?')).toBeTruthy()
  })
})
