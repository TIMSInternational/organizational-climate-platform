import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TranslationProvider } from '../../../i18n'
import { getToken, setToken, clearToken } from '../../../auth/token'
import TwoFactorCard from './TwoFactorCard'

/**
 * The profile's two-step verification card (contract §3). The token assertions are the point:
 * confirm and disable bump the server's stamp, so the OLD token is dead the moment they answer.
 */

type Answer = { status: number; body?: unknown }
let answers: Record<string, Answer> = {}
let sent: { path: string; body: unknown; authorization: string | null }[] = []

function status(overrides: Partial<Record<string, unknown>> = {}) {
  return { available: true, enabled: false, required: false, recoveryCodesRemaining: 0, enabledAt: null, ...overrides }
}

beforeEach(() => {
  answers = {}
  sent = []
  setToken('session-old')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = Object.keys(answers)
        .sort((a, b) => b.length - a.length)
        .find((key) => url.endsWith(key))
      sent.push({ path: path ?? url, body: init?.body ? JSON.parse(String(init.body)) : null, authorization: new Headers(init?.headers).get('Authorization') })
      const next = path ? answers[path] : { status: 404, body: { message: 'no fixture' } }
      return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  clearToken()
})

function renderCard() {
  return render(
    <TranslationProvider initialLocale="en">
      <TwoFactorCard />
    </TranslationProvider>,
  )
}

const KEY = { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/OCC:ana%40acme.test?secret=JBSWY3DPEHPK3PXP&issuer=OCC' }
const CODES = Array.from({ length: 10 }, (_, index) => `CCCC${index}-DDDD${index}`)

describe('TwoFactorCard', () => {
  it('renders nothing when the feature is off', async () => {
    answers['/profile/two-factor'] = { status: 200, body: status({ available: false }) }
    const { container } = renderCard()
    await waitFor(() => expect(sent.some((call) => call.path === '/profile/two-factor')).toBe(true))
    expect(container.textContent).toBe('')
  })

  it('turns it on: start → QR → confirm → the NEW token replaces the old → the ten codes', async () => {
    answers['/profile/two-factor'] = { status: 200, body: status() }
    answers['/profile/two-factor/start'] = { status: 200, body: KEY }
    answers['/profile/two-factor/confirm'] = { status: 200, body: { token: 'session-new', recoveryCodes: CODES } }
    renderCard()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /turn on two-step verification/i }))
    expect(await screen.findByRole('img', { name: /qr code/i })).toBeTruthy()
    expect(sent.find((call) => call.path === '/profile/two-factor/start')?.body).toEqual({ currentCode: null })

    await user.type(screen.getByLabelText(/6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /^confirm$/i }))

    expect(await screen.findByText(CODES[0])).toBeTruthy()
    expect(getToken()).toBe('session-new')
    const confirm = sent.find((call) => call.path === '/profile/two-factor/confirm')
    expect(confirm?.body).toEqual({ code: '123456' })
    // Bypassing authFetch must not drop the bearer: the call is made with the session it replaces.
    expect(confirm?.authorization).toBe('Bearer session-old')
  })

  it('turns it off with a current code, and stores the token the server answers', async () => {
    answers['/profile/two-factor'] = { status: 200, body: status({ enabled: true, recoveryCodesRemaining: 8, enabledAt: '2026-11-01T12:00:00Z' }) }
    answers['/profile/two-factor/disable'] = { status: 200, body: { token: 'session-after-disable' } }
    renderCard()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^turn off$/i }))
    await user.type(screen.getByLabelText(/current code/i), '654321')
    await user.click(screen.getByRole('button', { name: /turn off two-step verification/i }))

    await waitFor(() => expect(getToken()).toBe('session-after-disable'))
    expect(sent.find((call) => call.path === '/profile/two-factor/disable')?.body).toEqual({ code: '654321' })
    expect(await screen.findByText(/two-step verification is off/i)).toBeTruthy()
  })

  it('a wrong code keeps the session — 401 here is not a sign-out', async () => {
    answers['/profile/two-factor'] = { status: 200, body: status({ enabled: true }) }
    answers['/profile/two-factor/disable'] = { status: 401, body: { message: 'Invalid code.' } }
    renderCard()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^turn off$/i }))
    await user.type(screen.getByLabelText(/current code/i), '000000')
    await user.click(screen.getByRole('button', { name: /turn off two-step verification/i }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/check it and try again/i)
    expect(sent.find((call) => call.path === '/profile/two-factor/disable')?.authorization).toBe('Bearer session-old')
    // The status is re-read through authFetch to tell a wrong code from an ended session...
    await waitFor(() => expect(sent.filter((call) => call.path === '/profile/two-factor')).toHaveLength(2))
    // ...and the session answered 200, so the reader stays signed in.
    expect(getToken()).toBe('session-old')
  })

  it('a 401 from an ENDED session still signs the reader out, via the status re-read', async () => {
    answers['/profile/two-factor'] = { status: 200, body: status({ enabled: true }) }
    answers['/profile/two-factor/disable'] = { status: 401, body: { message: 'Unauthorized' } }
    renderCard()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^turn off$/i }))
    answers['/profile/two-factor'] = { status: 401, body: { message: 'Unauthorized' } }
    await user.type(screen.getByLabelText(/current code/i), '000000')
    await user.click(screen.getByRole('button', { name: /turn off two-step verification/i }))

    await waitFor(() => expect(getToken()).toBeNull())
  })

  it('a refusal other than a code is shown in the catalogue, not the server English', async () => {
    answers['/profile/two-factor'] = { status: 200, body: status() }
    answers['/profile/two-factor/start'] = { status: 200, body: KEY }
    answers['/profile/two-factor/confirm'] = { status: 400, body: { message: 'Start the set-up first.' } }
    renderCard()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /turn on two-step verification/i }))
    await user.type(await screen.findByLabelText(/6-digit code/i), '123456')
    await user.click(screen.getByRole('button', { name: /^confirm$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/an error occurred/i)
    expect(alert.textContent).not.toMatch(/start the set-up/i)
    expect(getToken()).toBe('session-old')
  })

  it('a required user gets no off switch, only a device change that sends the current code', async () => {
    answers['/profile/two-factor'] = { status: 200, body: status({ enabled: true, required: true, recoveryCodesRemaining: 10 }) }
    answers['/profile/two-factor/start'] = { status: 200, body: KEY }
    renderCard()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /change device/i }))
    expect(screen.queryByRole('button', { name: /^turn off$/i })).toBeNull()
    await user.type(screen.getByLabelText(/current code/i), '111222')
    await user.click(screen.getByRole('button', { name: /^continue$/i }))

    expect(await screen.findByRole('img', { name: /qr code/i })).toBeTruthy()
    expect(sent.find((call) => call.path === '/profile/two-factor/start')?.body).toEqual({ currentCode: '111222' })
  })

  it('a required user sees why it cannot be turned off', async () => {
    answers['/profile/two-factor'] = { status: 200, body: status({ enabled: true, required: true }) }
    renderCard()
    expect(await screen.findByText(/required for tims super administrators/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^turn off$/i })).toBeNull()
  })
})
