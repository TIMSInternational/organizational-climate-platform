import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../i18n'
import { setToken, clearToken } from '../../auth/token'
import { SidebarUserMenu } from './SidebarUserMenu'
import { tokenFor } from '../../test/jwtFixture'
import { clearCompanyNameCache } from '../../company-context/useCompanyName'
import es from '../../i18n/es.json'

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

describe('the canvas’s foot of the rail', () => {
  it('draws the avatar as the canvas’s round indigo mark, with no disclosure chevron beside the name', () => {
    setToken(tokenFor({ name: 'Rebeca Solís', role: 'super_admin', companyId: '' }))
    renderMenu()
    const avatar = document.querySelector('[data-slot="sidebar-avatar"]') as HTMLElement
    expect(avatar.textContent).toBe('R')
    expect(avatar.style.borderRadius).toBe('999px')
    expect(avatar.style.background).toContain('--admin-shell-bg-raised')
    const button = avatar.closest('button') as HTMLButtonElement
    expect(button.querySelector('svg')).toBeNull()
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
  })

  it('writes the super administrator’s role in Spanish sentence case, as the canvas does', () => {
    expect(es.users.superAdmin).toBe('Super administrador')
  })
})

describe('the role line', () => {
  function renderMenuEs() {
    render(
      <TranslationProvider initialLocale="es">
        <MemoryRouter>
          <SidebarUserMenu onSignOut={() => {}} />
        </MemoryRouter>
      </TranslationProvider>,
    )
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    clearCompanyNameCache()
  })

  it('names a leader’s department after the role — "Líder · Ingeniería", as the canvas’s rail prints it', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ companyName: 'Grupo Meridiano S.A.', departmentName: 'Ingeniería' }), { status: 200 }))),
    )
    setToken(tokenFor({ name: 'Luis Mora', role: 'leader', companyId: 'c1' }))
    renderMenuEs()
    await waitFor(() => expect(document.querySelector('[data-slot="sidebar-role"]')?.textContent).toBe(`${es.users.leader} · Ingeniería`))
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe('http://api.test/profile')
  })

  it('keeps the role alone for a leader with no department, and for an administrator asks /profile nothing', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.test')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ companyName: 'x', departmentName: null }), { status: 200 }))))
    setToken(tokenFor({ name: 'Luis Mora', role: 'leader', companyId: 'c1' }))
    renderMenuEs()
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(document.querySelector('[data-slot="sidebar-role"]')?.textContent).toBe(es.users.leader)
    cleanup()
    clearCompanyNameCache()
    vi.mocked(fetch).mockClear()
    setToken(tokenFor({ name: 'Ana Rojas', role: 'company_admin', companyId: 'c1' }))
    renderMenuEs()
    expect(document.querySelector('[data-slot="sidebar-role"]')?.textContent).toBe(es.users.companyAdmin)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
