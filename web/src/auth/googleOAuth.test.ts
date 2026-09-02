import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  beginGoogleSignIn,
  buildGoogleAuthUrl,
  googleClientId,
  readGoogleCallback,
  takeGoogleHandshake,
  type GoogleHandshake,
} from './googleOAuth'
import { tokenFor as idTokenFor } from '../test/jwtFixture'

/** An unsigned JWT whose payload is exactly `claims`. Only the payload is read here. */

const HANDSHAKE: GoogleHandshake = { state: 'state-abc', nonce: 'nonce-xyz' }

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  sessionStorage.clear()
})

describe('googleClientId', () => {
  it('is absent when nothing is configured, so the button can be omitted', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    expect(googleClientId()).toBeNull()
  })

  it('ignores a whitespace-only value rather than sending it to Google', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '   ')
    expect(googleClientId()).toBeNull()
  })

  it('trims what is configured', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', ' 123.apps.googleusercontent.com ')
    expect(googleClientId()).toBe('123.apps.googleusercontent.com')
  })
})

describe('buildGoogleAuthUrl', () => {
  it('asks for an ID token, which is the only thing POST /auth/google can verify', () => {
    const url = new URL(buildGoogleAuthUrl('client-1', 'https://app.example/auth/loading', HANDSHAKE))

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('response_type')).toBe('id_token')
    expect(url.searchParams.get('client_id')).toBe('client-1')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/auth/loading')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
    expect(url.searchParams.get('state')).toBe('state-abc')
    expect(url.searchParams.get('nonce')).toBe('nonce-xyz')
    // The company is derived from the email domain, so which account signs in
    // decides which organization is joined -- never reuse one silently.
    expect(url.searchParams.get('prompt')).toBe('select_account')
  })
})

describe('beginGoogleSignIn', () => {
  it('comes back to /auth/loading on the same origin', () => {
    const url = new URL(beginGoogleSignIn('client-1', 'https://app.example'))

    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/auth/loading')
  })

  it('stores the handshake it sent, so the callback has something to be checked against', () => {
    const url = new URL(beginGoogleSignIn('client-1', 'https://app.example'))
    const stored = takeGoogleHandshake()

    expect(stored?.state).toBe(url.searchParams.get('state'))
    expect(stored?.nonce).toBe(url.searchParams.get('nonce'))
  })

  it('mints a fresh state and nonce every time', () => {
    const first = new URL(beginGoogleSignIn('client-1', 'https://app.example'))
    const second = new URL(beginGoogleSignIn('client-1', 'https://app.example'))

    expect(first.searchParams.get('state')).not.toBe(second.searchParams.get('state'))
    expect(first.searchParams.get('nonce')).not.toBe(second.searchParams.get('nonce'))
    // 128 bits, hex.
    expect(first.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('takeGoogleHandshake', () => {
  it('consumes the handshake, so one redirect can only be completed once', () => {
    beginGoogleSignIn('client-1', 'https://app.example')

    expect(takeGoogleHandshake()).not.toBeNull()
    expect(takeGoogleHandshake()).toBeNull()
  })

  it('survives junk in storage rather than throwing on the way back from Google', () => {
    sessionStorage.setItem('climate.auth.google-handshake', 'not json')
    expect(takeGoogleHandshake()).toBeNull()
  })
})

describe('readGoogleCallback', () => {
  const okToken = idTokenFor({ nonce: 'nonce-xyz', email: 'ana@acme.com' })

  it('accepts a fragment whose state and nonce both match the stored handshake', () => {
    const result = readGoogleCallback(`#id_token=${okToken}&state=state-abc`, '', HANDSHAKE)

    expect(result).toEqual({ status: 'ok', idToken: okToken })
  })

  it('reports a bare visit to /auth/loading as absent, not as an error', () => {
    // Nobody came back from anywhere -- somebody typed the URL. Calling that a
    // failed sign-in would be a lie.
    expect(readGoogleCallback('', '', HANDSHAKE)).toEqual({ status: 'absent' })
  })

  it('reads an error delivered as a query string as well as one in the fragment', () => {
    expect(readGoogleCallback('', '?error=access_denied&state=state-abc', HANDSHAKE)).toEqual({ status: 'denied' })
    expect(readGoogleCallback('#error=access_denied', '', HANDSHAKE)).toEqual({ status: 'denied' })
  })

  /**
   * The login-CSRF branch. Without the state check, sending a victim to
   * `/auth/loading#id_token=<attacker's token>` signs them into the ATTACKER's
   * account, and everything they then submit lands in it.
   */
  it('refuses a token whose state is not the one this browser sent', () => {
    const result = readGoogleCallback(`#id_token=${okToken}&state=someone-elses`, '', HANDSHAKE)

    expect(result).toEqual({ status: 'mismatch' })
  })

  it('refuses a token that arrives with no state at all', () => {
    expect(readGoogleCallback(`#id_token=${okToken}`, '', HANDSHAKE)).toEqual({ status: 'mismatch' })
  })

  it('refuses a token when no handshake was ever stored', () => {
    // A second tab, or a link followed from outside the app entirely.
    expect(readGoogleCallback(`#id_token=${okToken}&state=state-abc`, '', null)).toEqual({ status: 'mismatch' })
  })

  /**
   * `state` proves the CALLBACK came from a handshake this browser started; only
   * the nonce proves the TOKEN did. A token lifted from another flow, replayed
   * alongside a leaked state, passes every other check here.
   */
  it('refuses a token whose own nonce is not the one that was requested', () => {
    const replayed = idTokenFor({ nonce: 'nonce-from-another-flow', email: 'ana@acme.com' })

    expect(readGoogleCallback(`#id_token=${replayed}&state=state-abc`, '', HANDSHAKE)).toEqual({ status: 'mismatch' })
  })

  it('refuses a token carrying no nonce claim', () => {
    const noNonce = idTokenFor({ email: 'ana@acme.com' })

    expect(readGoogleCallback(`#id_token=${noNonce}&state=state-abc`, '', HANDSHAKE)).toEqual({ status: 'mismatch' })
  })

  it('refuses an id_token that is not a JWT at all', () => {
    expect(readGoogleCallback('#id_token=garbage&state=state-abc', '', HANDSHAKE)).toEqual({ status: 'mismatch' })
  })
})
