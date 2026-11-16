import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider } from '../../../i18n'
import { clearToken, setToken } from '../../../auth/token'
import { tokenFor } from '../../../test/jwtFixture'
import type { User } from '../api/users'
import { TwoFactorReset } from './PersonDetails'

/** Admin reset of a person's two-step verification (contract §4): super administrators only. */

const PERSON = { id: 'user-7', name: 'Ana Mora', email: 'ana@acme.test' } as User
let calls: { url: string; method: string }[] = []

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? 'GET' })
      if (url.endsWith('/admin/users/user-7/two-factor/reset')) return new Response(null, { status: 204 })
      if (url.endsWith('/admin/users/user-7/two-factor')) {
        return new Response(JSON.stringify({ enabled: true, enabledAt: '2026-11-02T15:00:00Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(null, { status: 404 })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearToken()
})

function renderAs(role: string) {
  setToken(tokenFor({ role, companyId: 'company-1' }))
  return render(
    <TranslationProvider initialLocale="en">
      <TwoFactorReset user={PERSON} baseUrl="http://api.test" />
    </TranslationProvider>,
  )
}

describe('TwoFactorReset', () => {
  it('shows a super administrator the status and resets through the endpoint after confirming', async () => {
    renderAs('super_admin')
    const user = userEvent.setup()

    expect((await screen.findByText(/on since/i)).textContent).toMatch(/2026|nov/i)
    await user.click(screen.getByRole('button', { name: /reset two-step verification/i }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/ana mora/i)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: /^reset$/i }))

    await waitFor(() => expect(calls).toContainEqual({ url: 'http://api.test/admin/users/user-7/two-factor/reset', method: 'POST' }))
    expect(await screen.findByText(/two-step verification was reset for ana mora/i)).toBeTruthy()
    expect(screen.getByText(/not set up/i)).toBeTruthy()
  })

  it.each(['company_admin', 'leader', 'employee'])('renders nothing and requests nothing for %s', async (role) => {
    const { container } = renderAs(role)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(container.textContent).toBe('')
    expect(calls).toEqual([])
  })
})
