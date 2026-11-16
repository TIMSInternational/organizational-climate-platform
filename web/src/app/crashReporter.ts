import { isRouteErrorResponse, matchRoutes } from 'react-router'
import { buildInfo } from './buildInfo'

/**
 * Website crash reports (#158): a render error caught by `RouteErrorBoundary`, an uncaught
 * error, or an unhandled promise rejection is sent to the API's `POST /client-errors`, which
 * writes it as one Warning line that a CloudWatch alarm counts. Before this, a broken screen in
 * front of a client's respondents was invisible until one of them wrote in.
 *
 * ## What a report may carry — and what it must never carry
 *
 * - **The matched ROUTE PATTERN (`/s/:token`), never `location.pathname`.** A respondent's path
 *   IS their access token (`/s/:token`, `/survey-invitations/:token`), and an administrator's
 *   path names a survey or a company. The pattern comes from the router's own route table via
 *   `matchRoutes`, so nothing typed into the address bar reaches it.
 * - The error's message (≤ 500) and stack (≤ 2 KB) after `scrub`: query strings and fragments
 *   removed (that is where tokens travel), emails and token-shaped runs replaced.
 * - The build stamp (`web/docs/build-stamp.md`) — which commit crashed. The API takes the user
 *   agent from the request header; nothing here sends it.
 * - **No bearer token.** Sent with `credentials: 'omit'` and no `Authorization` header: the
 *   route is anonymous, and a report must not identify the person who saw the crash.
 * - Never an answer, a name or a response body: a rejection whose reason is not an `Error` or a
 *   string is reported by its TYPE only, because an object rejected by a fetch helper can be
 *   the payload it was sending.
 *
 * ## It must never make things worse
 *
 * At most `MAX_REPORTS_PER_PAGE_LOAD` reports per page load, one per distinct message and
 * route; fire-and-forget (`fetch` with `keepalive`, so it survives the reload the error card
 * offers); every path wrapped so that reporting a crash can never throw one. The body is sent as
 * `text/plain`, a CORS-safelisted type, so a cross-origin report needs no preflight — browsers
 * have refused or dropped preflighted `keepalive` requests.
 */

/** Reports one page load may send, however many errors it throws. */
export const MAX_REPORTS_PER_PAGE_LOAD = 5

/** What a path that matches no route is reported as — never the path itself. */
export const UNMATCHED_ROUTE = '(unmatched)'

const MESSAGE_MAX = 500
const STACK_MAX = 2048
const ROUTE_PATH = '/client-errors'

type RouteTable = Parameters<typeof matchRoutes>[0]

/**
 * The route pattern `pathname` matches in `routes`: `/surveys/:id/results`, with the
 * placeholders left as placeholders. Nested relative paths are joined; an absolute child path
 * replaces what came before it, as react-router does.
 */
export function routePatternFor(routes: RouteTable, pathname: string): string {
  try {
    const matches = matchRoutes(routes, pathname)
    if (!matches || matches.length === 0) return UNMATCHED_ROUTE
    let pattern = ''
    for (const match of matches) {
      const path = match.route.path
      if (!path) continue
      pattern = path.startsWith('/') ? path : `${pattern.replace(/\/$/, '')}/${path}`
    }
    return pattern === '' ? '/' : pattern
  } catch {
    return UNMATCHED_ROUTE
  }
}

const QUERY_OR_FRAGMENT = /[?#][^\s()"'<>]*?(?=:\d+:\d+(?!\d)|[\s()"'<>]|$)/g
const EMAIL = /[^\s@()"'<>,;:/]+@[^\s@()"'<>,;:/]+\.[A-Za-z]{2,}/g
const TOKEN_SHAPED = /(?=[A-Za-z_-]*[0-9])[A-Za-z0-9_-]{24,}/g
const BUNDLE_CHUNK = /^[A-Za-z]+-[A-Za-z0-9_-]{8}$/

/**
 * Removes what must never leave the browser in a report: query strings and fragments (kept is
 * a stack frame's `:line:column`), emails, and 24+-character token-shaped runs that contain a
 * digit — except Vite's `PageName-hash8` chunk names, the most useful thing in a frame. The API
 * applies the same rules again; this copy is so that nothing sensitive is SENT.
 */
export function scrub(text: string): string {
  return text
    .replace(QUERY_OR_FRAGMENT, '')
    .replace(EMAIL, '[email]')
    .replace(TOKEN_SHAPED, (run) => (BUNDLE_CHUNK.test(run) ? run : '[redacted]'))
}

function bounded(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text
}

interface Described {
  text: string
  stack: string
}

/** The message and stack of whatever was thrown, without ever serialising an object. */
function describe(thrown: unknown): Described | null {
  if (thrown instanceof Error) {
    return { text: `${thrown.name}: ${thrown.message}`, stack: thrown.stack ?? '' }
  }
  if (isRouteErrorResponse(thrown)) {
    // A thrown 404 or 403 response is the router saying "not here", not a crash.
    if (thrown.status < 500) return null
    return { text: `route error response ${thrown.status}`, stack: '' }
  }
  if (typeof thrown === 'string') return { text: thrown, stack: '' }
  return { text: `non-error ${thrown === null ? 'null' : typeof thrown}`, stack: '' }
}

interface ReporterState {
  endpoint: string
  resolveRoute: (pathname: string) => string
  sent: number
  seen: Set<string>
}

let state: ReporterState | null = null

/**
 * Reports `thrown` as a crash on `pathname` (default: the current location). Never throws, and
 * does nothing until `installCrashReporting` has run.
 */
export function reportCrash(thrown: unknown, pathname?: string): void {
  try {
    const reporter = state
    if (!reporter || reporter.sent >= MAX_REPORTS_PER_PAGE_LOAD) return
    const described = describe(thrown)
    if (!described) return

    const route = reporter.resolveRoute(pathname ?? window.location.pathname)
    const text = bounded(scrub(described.text), MESSAGE_MAX)
    const key = `${route} ${text}`
    if (reporter.seen.has(key)) return
    reporter.seen.add(key)
    reporter.sent += 1

    const body = JSON.stringify({
      message: text,
      stack: bounded(scrub(described.stack), STACK_MAX),
      route,
      build: buildInfo.commit,
    })

    void fetch(reporter.endpoint, {
      method: 'POST',
      body,
      keepalive: true,
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain' },
    }).catch(() => undefined)
  } catch {
    // Reporting a crash must never be the second crash.
  }
}

/**
 * Starts reporting: `error` and `unhandledrejection` on `target`, plus whatever
 * `RouteErrorBoundary` passes to `reportCrash`. Returns the function that stops it (tests).
 *
 * `baseUrl` is the API's (`VITE_API_BASE_URL`). With none, nothing is installed: a relative
 * `/client-errors` would be answered by the web host's SPA fallback with a 200 and `index.html`,
 * and look like a report that arrived.
 */
export function installCrashReporting(options: {
  baseUrl: string | undefined
  resolveRoute: (pathname: string) => string
  target?: Window
}): () => void {
  const baseUrl = (options.baseUrl ?? '').trim().replace(/\/+$/, '')
  if (baseUrl === '') {
    state = null
    return () => undefined
  }

  state = { endpoint: `${baseUrl}${ROUTE_PATH}`, resolveRoute: options.resolveRoute, sent: 0, seen: new Set() }
  const target = options.target ?? window

  const onError = (event: ErrorEvent) => {
    // "Script error." with no error object is a cross-origin script the browser will not
    // describe — an extension, an embed. Nothing in it can be acted on.
    if (!event.error && event.message === 'Script error.') return
    reportCrash(event.error ?? event.message)
  }
  const onRejection = (event: PromiseRejectionEvent) => reportCrash(event.reason)

  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)

  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
    state = null
  }
}
