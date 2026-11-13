import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TranslationProvider } from '../../../i18n'
import { clearToken, setToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import AccountTabs from './AccountTabs'
import en from '../../../i18n/en.json'

afterEach(() => {
  cleanup()
  clearToken()
})

function renderAt(path: string) {
  setToken(tokenFor({ role: 'company_admin', companyId: 'c1' }))
  return render(
    <TranslationProvider>
      <MemoryRouter initialEntries={[path]}>
        <AccountTabs />
      </MemoryRouter>
    </TranslationProvider>,
  )
}

/**
 * The chosen account page is told by an edge that clears 3:1, not by a raised fill.
 *
 * Review of 12 Nov: in dark the raised card is darker than the old `--fill` track, so the
 * chosen tab measured 1.30:1 against it with only a weight change, under the 3:1 WCAG 1.4.11
 * asks of a state cue. happy-dom computes no colour, so the classes are the pin: the chosen
 * tab wears `border-line-control` (held to 3:1 by `controlBoundaryContrast.test.ts`), and the
 * others the secondary ink with no edge.
 */
describe('AccountTabs', () => {
  it('edges the chosen page in the control line and leaves the others edgeless in the secondary ink', () => {
    renderAt('/settings/notifications')
    const chosen = screen.getByRole('link', { name: en.profile.next.tabs.notifications })
    expect(chosen.getAttribute('aria-current')).toBe('page')
    expect(chosen.className.split(/\s+/)).toEqual(expect.arrayContaining(['border', 'border-line-control', 'font-semibold', 'text-fg-primary']))
    for (const name of [en.profile.next.tabs.profile, en.profile.next.tabs.privacy]) {
      const other = screen.getByRole('link', { name })
      expect(other.getAttribute('aria-current')).toBeNull()
      expect(other.className.split(/\s+/)).toEqual(expect.arrayContaining(['border-transparent', 'text-fg-secondary']))
      expect(other.className.split(/\s+/)).not.toContain('border-line-control')
    }
  })
})
