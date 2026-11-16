import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import LoginNextPage from './LoginNextPage'
import TwoFactorNextPage from './TwoFactorNextPage'
import { TranslationProvider } from '../../i18n'
import { clearToken, getToken } from '../token'
import { clearChallenge, readChallenge, saveChallenge, normaliseCode, groupSecret } from '../twoFactor'

/**
 * Two-factor sign-in (contract §1–§2). Every API answer is a mocked `fetch`, keyed by path; the
 * body each call sent is kept so the tests can assert what reached the server.
 */

type Answer = { status: number; body?: unknown }
let answers: Record<string, Answer[]> = {}
let sent: { path: string; body: unknown; authorization: string | null }[] = []

function answer(path: string, ...queue: Answer[]) {
  answers[path] = queue
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  answers = {}
  sent = []
  clearToken()
  clearChallenge()
  sessionStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = Object.keys(answers).find((key) => url.endsWith(key))
      sent.push({
        path: path ?? url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        authorization: new Headers(init?.headers).get('Authorization'),
      })
      const queue = path ? answers[path] : undefined
      const next = queue && queue.length > 1 ? queue.shift() : queue?.[0]
      return next ? json(next.status, next.body) : json(404, { message: 'no fixture' })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  sessionStorage.clear()
  clearChallenge()
  clearToken()
})

function Probe() {
  return <p data-testid="path">{useLocation().pathname}</p>
}

function renderAt(entry: string) {
  return render(
    <TranslationProvider initialLocale="en">
      <MemoryRouter initialEntries={[entry]}>
        <Probe />
        <Routes>
          <Route path="/login" element={<LoginNextPage />} />
          <Route path="/login/two-factor" element={<TwoFactorNextPage />} />
          <Route path="/dashboard" element={<p>dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  )
}

const path = () => screen.getByTestId('path').textContent

/** The challenge is a credential held in memory: no browser storage may ever contain it. */
function storageHolds(secret: string): boolean {
  for (const store of [localStorage, sessionStorage]) {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index) ?? ''
      if (key.includes(secret) || (store.getItem(key) ?? '').includes(secret)) return true
    }
  }
  return false
}

/** After `userEvent.setup()`, which installs its own clipboard stub over `navigator.clipboard`. */
function stubClipboard(writeText: (text: string) => Promise<void> = async () => undefined) {
  const mock = vi.fn(writeText)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: mock }, configurable: true })
  return mock
}

async function signIn() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/email address or username/i), 'ana@acme.test')
  await user.type(screen.getByLabelText(/^password/i), 'secret-pass')
  await user.click(screen.getByRole('button', { name: /^sign in$/i }))
  return user
}

function pendingChallenge(mode: 'verify' | 'enroll', expiresAt = Date.now() + 300_000) {
  saveChallenge({ mode, challengeToken: `challenge-${mode}`, expiresAt, returnPath: null })
}

describe('plain sign-in is unchanged', () => {
  it('stores the token and goes to the dashboard when no second step is asked for', async () => {
    answer('/auth/login', { status: 200, body: { token: 'session-plain' } })
    renderAt('/login')
    await signIn()
    await waitFor(() => expect(path()).toBe('/dashboard'))
    expect(getToken()).toBe('session-plain')
    expect(readChallenge()).toBeNull()
  })
})

describe('the verify step', () => {
  it('sends the reader to the second step WITHOUT a session, then stores the token it answers', async () => {
    answer('/auth/login', { status: 200, body: { twoFactor: 'verify', challengeToken: 'challenge-1', expiresInSeconds: 300 } })
    answer('/auth/two-factor/verify', { status: 200, body: { token: 'session-2fa', recoveryCodesRemaining: null } })
    renderAt('/login')
    const user = await signIn()

    await waitFor(() => expect(path()).toBe('/login/two-factor'))
    expect(getToken()).toBeNull()
    expect(readChallenge()?.challengeToken).toBe('challenge-1')
    expect(storageHolds('challenge-1')).toBe(false)

    await user.type(screen.getByLabelText(/verification code/i), '123456')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    await waitFor(() => expect(path()).toBe('/dashboard'))
    expect(getToken()).toBe('session-2fa')
    const verify = sent.find((call) => call.path === '/auth/two-factor/verify')
    expect(verify?.body).toEqual({ challengeToken: 'challenge-1', code: '123456' })
    // In the body, never as a bearer.
    expect(verify?.authorization).toBeNull()
    expect(readChallenge()).toBeNull()
    expect(storageHolds('challenge-1')).toBe(false)
  })

  it('a wrong code (401) says so, stores nothing, and keeps the reader on the step', async () => {
    pendingChallenge('verify')
    answer('/auth/two-factor/verify', { status: 401, body: { message: 'Invalid code.' } })
    renderAt('/login/two-factor')
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/verification code/i), '000000')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/that code did not work/i)
    expect(getToken()).toBeNull()
    expect(path()).toBe('/login/two-factor')
  })

  it('a refusal other than a wrong code is shown in the catalogue, not the server English', async () => {
    pendingChallenge('verify')
    answer('/auth/two-factor/verify', { status: 400, body: { message: 'Start the set-up first.' } })
    renderAt('/login/two-factor')
    const user = userEvent.setup()

    await user.type(screen.getByLabelText(/verification code/i), '123456')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/an error occurred/i)
    expect(alert.textContent).not.toMatch(/start the set-up/i)
  })

  it('takes a recovery code, sends it in canonical form, and says how many are left', async () => {
    pendingChallenge('verify')
    answer('/auth/two-factor/verify', { status: 200, body: { token: 'session-recovery', recoveryCodesRemaining: 9 } })
    renderAt('/login/two-factor')
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /use a recovery code/i }))
    await user.type(screen.getByLabelText(/recovery code/i), 'abcde fghij')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(await screen.findByText(/recovery codes left: 9/i)).toBeTruthy()
    expect(getToken()).toBe('session-recovery')
    expect(sent.find((call) => call.path === '/auth/two-factor/verify')?.body).toEqual({ challengeToken: 'challenge-verify', code: 'ABCDE-FGHIJ' })

    await user.click(screen.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => expect(path()).toBe('/dashboard'))
  })

  it('an expired challenge shows the expired card and goes back to sign in', async () => {
    pendingChallenge('verify', Date.now() - 1)
    renderAt('/login/two-factor')
    const user = userEvent.setup()

    expect(screen.getByText(/this sign-in step expired/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /back to sign in/i }))
    await waitFor(() => expect(path()).toBe('/login'))
    expect(readChallenge()).toBeNull()
  })

  it('with no challenge at all, the step is not reachable', async () => {
    renderAt('/login/two-factor')
    await waitFor(() => expect(path()).toBe('/login'))
  })
})

describe('the forced enrollment step (super administrator)', () => {
  it('starts, shows the QR and the grouped key, confirms, shows the ten codes once, then signs in', async () => {
    answer('/auth/login', { status: 200, body: { twoFactor: 'enroll', challengeToken: 'challenge-e', expiresInSeconds: 300 } })
    answer('/auth/two-factor/enrollment/start', {
      status: 200,
      body: { secret: 'JBSWY3DPEHPK3PXPJBSWY3DP', otpauthUri: 'otpauth://totp/OCC:ana%40acme.test?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=OCC' },
    })
    const codes = Array.from({ length: 10 }, (_, index) => `AAAA${index}-BBBB${index}`)
    answer('/auth/two-factor/enrollment/confirm', { status: 200, body: { token: 'session-enrolled', recoveryCodes: codes } })
    renderAt('/login')
    const user = await signIn()

    await waitFor(() => expect(path()).toBe('/login/two-factor'))
    expect(screen.getByText(/super administrator accounts/i)).toBeTruthy()
    expect(await screen.findByRole('img', { name: /qr code/i })).toBeTruthy()
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP')).toBeTruthy()
    expect(sent.find((call) => call.path === '/auth/two-factor/enrollment/start')?.body).toEqual({ challengeToken: 'challenge-e' })

    await user.type(screen.getByLabelText(/6-digit code/i), '654321')
    await user.click(screen.getByRole('button', { name: /^confirm$/i }))

    expect(await screen.findByText(/save your recovery codes/i)).toBeTruthy()
    for (const code of codes) expect(screen.getByText(code)).toBeTruthy()
    // The codes are on screen and the token is NOT stored until the reader says they saved them.
    expect(getToken()).toBeNull()

    const writeText = stubClipboard()
    await user.click(screen.getByRole('button', { name: /copy codes/i }))
    expect(writeText).toHaveBeenCalledWith(codes.join('\n'))
    expect(await screen.findByText(/^copied\.$/i)).toBeTruthy()

    const createObjectURL = vi.fn((blob: Blob) => {
      downloaded = blob
      return 'blob:codes'
    })
    let downloaded: Blob | null = null
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    await user.click(screen.getByRole('button', { name: /download codes/i }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const text = await (downloaded as unknown as Blob).text()
    for (const code of codes) expect(text).toContain(code)

    await user.click(screen.getByRole('button', { name: /i saved them/i }))
    await waitFor(() => expect(path()).toBe('/dashboard'))
    expect(getToken()).toBe('session-enrolled')
  })

  it('says so when the clipboard refuses', async () => {
    pendingChallenge('enroll')
    answer('/auth/two-factor/enrollment/start', { status: 200, body: { secret: 'ABCDEFGH', otpauthUri: 'otpauth://totp/OCC:x?secret=ABCDEFGH' } })
    renderAt('/login/two-factor')
    const user = userEvent.setup()
    stubClipboard(async () => {
      throw new Error('denied')
    })

    await user.click(await screen.findByRole('button', { name: /copy key/i }))
    expect(await screen.findByText(/could not copy/i)).toBeTruthy()
  })
})

describe('code normalisation', () => {
  it('keeps digits of an app code and rebuilds a recovery code', () => {
    expect(normaliseCode(' 12 34-56 ', 'totp')).toBe('123456')
    expect(normaliseCode('abcde-fghij', 'recovery')).toBe('ABCDE-FGHIJ')
    expect(normaliseCode('ABCDEFGHIJ', 'recovery')).toBe('ABCDE-FGHIJ')
    expect(groupSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ')
  })
})
