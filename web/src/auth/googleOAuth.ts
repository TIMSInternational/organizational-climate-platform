import { decodeJwtPayload } from './jwt'

/**
 * The browser half of Google sign-in (#81).
 *
 * ## Why this exists at all
 *
 * `POST /auth/google` has been on the server since before this repo's first
 * frontend commit: it takes `{ idToken }`, verifies it against
 * `GoogleClientId` (`GoogleTokenVerifier`), and mints the same `{ token }` login
 * does. **Nothing in `web/src` ever called it.** #81's fourth acceptance
 * criterion — "Google sign-in shows the loading interstitial" — had no producer
 * because there was no Google sign-in, which is also why `/auth/loading` was a
 * component with no route in front of it. This module is that missing producer.
 *
 * ## Why the redirect flow and not the Google Identity Services script
 *
 * The server accepts an **OpenID Connect ID token** and nothing else — no
 * authorization code, and there is no code-exchange endpoint to add one to (that
 * would need the client secret, which a browser must never hold). The one way to
 * obtain an ID token straight in the browser is the OIDC implicit flow:
 * `response_type=id_token` at Google's authorization endpoint, which redirects
 * back with the token in the URL fragment.
 *
 * Doing it with a redirect rather than by injecting `accounts.google.com/gsi/client`
 * also means:
 *
 * - `/auth/loading` becomes the **real** OAuth round-trip landing page the issue
 *   describes, rather than a route invented to have somewhere to put a spinner;
 * - no third-party script executes on the login page, and nothing is added to the
 *   dependency graph;
 * - the whole protocol is two pure functions, which is what makes it testable
 *   here instead of only against Google.
 *
 * ## The two checks that make the fragment trustworthy
 *
 * A URL fragment is attacker-writable — anyone can send a victim to
 * `/auth/loading#id_token=…`. Two things are pinned before the token is sent
 * anywhere:
 *
 * - **`state`** must equal the value stored in `sessionStorage` just before the
 *   redirect. This is what stops a cross-site login CSRF, where an attacker walks
 *   a victim through *their* Google account and silently signs the victim into it.
 * - **`nonce`** must equal the one in the ID token's own payload. `state` alone
 *   does not bind the *token* to this handshake — an ID token captured from
 *   another flow could be pasted in alongside a replayed `state`. The nonce is
 *   minted per handshake, Google copies it into the signed payload, and it is the
 *   only field that ties the token to the request that asked for it.
 *
 * The token is not otherwise trusted here: the signature is checked by the server
 * (`GoogleJsonWebSignature.ValidateAsync`), which is the only place that can.
 * `decodeJwtPayload` is used exclusively to read the nonce back.
 */

/** Google's OIDC authorization endpoint. */
const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

/**
 * Where the handshake lives between the redirect out and the redirect back.
 *
 * `sessionStorage`, not `localStorage`: the handshake is worthless after this tab
 * finishes with it, and a second tab must not be able to complete a sign-in the
 * first one started.
 */
const HANDSHAKE_KEY = 'climate.auth.google-handshake'

/** The route Google is told to come back to — the `/auth/loading` interstitial. */
export const GOOGLE_REDIRECT_PATH = '/auth/loading'

export interface GoogleHandshake {
  /** Echoed by Google in the callback; pins the callback to this browser. */
  state: string
  /** Copied by Google into the signed ID token; pins the token to this request. */
  nonce: string
}

/**
 * The configured OAuth client id, or `null` when Google sign-in is not set up.
 *
 * Read at call time rather than at module load so a deployment (and a test) can
 * change it, and so the login page can simply omit the button when it is absent —
 * a "Continue with Google" that can only ever fail is worse than no button.
 *
 * This is the one auth value that legitimately comes from the environment: it is
 * the *client's* public identity at Google, the same string the API validates the
 * token's audience against. Company scoping still comes from JWT claims.
 */
export function googleClientId(): string | null {
  const configured = import.meta.env.VITE_GOOGLE_CLIENT_ID
  return typeof configured === 'string' && configured.trim() !== '' ? configured.trim() : null
}

/** 128 bits of `crypto`-grade randomness, hex encoded. Not `Math.random`. */
function randomToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function buildGoogleAuthUrl(
  clientId: string,
  redirectUri: string,
  handshake: GoogleHandshake,
): string {
  const url = new URL(AUTHORIZE_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  // An ID token is what `POST /auth/google` verifies; an access token would be
  // useless to it.
  url.searchParams.set('response_type', 'id_token')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('nonce', handshake.nonce)
  url.searchParams.set('state', handshake.state)
  // The server derives the company from the email domain, so which account is
  // chosen matters. Never silently reuse whichever one Google happens to hold.
  url.searchParams.set('prompt', 'select_account')
  return url.toString()
}

/**
 * Mints a handshake, stores it, and returns the URL to send the browser to.
 *
 * Returns the URL instead of navigating so the navigation stays at the call site,
 * where it is one obvious line, and so this is testable without a jsdom that can
 * leave the page.
 */
export function beginGoogleSignIn(clientId: string, origin: string): string {
  const handshake: GoogleHandshake = { state: randomToken(), nonce: randomToken() }
  sessionStorage.setItem(HANDSHAKE_KEY, JSON.stringify(handshake))
  return buildGoogleAuthUrl(clientId, `${origin}${GOOGLE_REDIRECT_PATH}`, handshake)
}

/**
 * Reads the pending handshake **without** removing it.
 *
 * Separate from `clearGoogleHandshake` because the decision to consume depends on
 * something the caller learns only after parsing the callback: whether a redirect
 * actually came back. Consuming first meant that opening `/auth/loading` with no
 * fragment — a bookmark, a back button, a link — destroyed a handshake that was
 * still waiting for its real redirect, and the sign-in that followed reported a
 * mismatch it had not earned. See `AuthLoadingPage`.
 */
export function peekGoogleHandshake(): GoogleHandshake | null {
  const stored = sessionStorage.getItem(HANDSHAKE_KEY)
  if (!stored) return null

  try {
    const parsed = JSON.parse(stored) as { state?: unknown; nonce?: unknown }
    if (typeof parsed.state !== 'string' || typeof parsed.nonce !== 'string') return null
    return { state: parsed.state, nonce: parsed.nonce }
  } catch {
    return null
  }
}

/**
 * Drops the pending handshake, so one redirect can be completed exactly once. A
 * handshake left in storage is a replay window.
 */
export function clearGoogleHandshake(): void {
  sessionStorage.removeItem(HANDSHAKE_KEY)
}

/**
 * Peek and clear in one call — the correct pairing whenever a redirect *has* come
 * back and is about to be judged.
 */
export function takeGoogleHandshake(): GoogleHandshake | null {
  const handshake = peekGoogleHandshake()
  clearGoogleHandshake()
  return handshake
}

export type GoogleCallback =
  | { status: 'ok'; idToken: string }
  /** No `id_token` and no `error`: somebody opened `/auth/loading` directly. */
  | { status: 'absent' }
  /** Google refused, or the user closed the consent screen. */
  | { status: 'denied' }
  /** A token arrived that this browser did not ask for. */
  | { status: 'mismatch' }

/**
 * Turns the callback URL into one of four outcomes.
 *
 * Both `hash` and `search` are read because the implicit flow returns its result
 * in the fragment while some error redirects arrive as a query string; taking
 * only one of them would drop half the failures on the floor.
 */
export function readGoogleCallback(
  hash: string,
  search: string,
  expected: GoogleHandshake | null,
): GoogleCallback {
  const fromHash = new URLSearchParams(hash.replace(/^#/, ''))
  const fromSearch = new URLSearchParams(search)
  const param = (name: string): string | null => fromHash.get(name) ?? fromSearch.get(name)

  // Checked first: a refusal carries no token, so there is nothing for the state
  // check to protect, and "you cancelled" is a truer thing to say than "something
  // went wrong".
  if (param('error')) return { status: 'denied' }

  const idToken = param('id_token')
  if (!idToken) return { status: 'absent' }

  if (!expected || param('state') !== expected.state) return { status: 'mismatch' }

  const payload = decodeJwtPayload(idToken)
  const nonce = typeof payload?.nonce === 'string' ? payload.nonce : null
  if (nonce !== expected.nonce) return { status: 'mismatch' }

  return { status: 'ok', idToken }
}
