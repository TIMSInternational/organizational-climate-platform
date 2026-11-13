/**
 * The part of `rehearse.mjs` that can be checked without a browser
 * (`rehearse-harness.test.mjs`): which steps a `--only` prefix selects, what the run's exit
 * code says, the accessible names it clicks by, which survey step 04 reads and the session
 * `--open-microclimate` opens for step 14.
 *
 * The names are here, and case-insensitive, because the rehearsal's first failure was its
 * own: it looked for `Iniciar sesión` and `Vista previa` on screens whose buttons read
 * `Iniciar Sesión` and `Vista Previa` — every other step passed, and the run reported a defect
 * in a product that had none. A selector is a claim about the screen; the claim is the words,
 * not the capitalisation the button happens to render them in.
 */

/** Accessible names the rehearsal clicks or waits for, Spanish first, English as the fallback. */
export const NAMES = {
  signIn: /Iniciar sesión|Entrar|Sign in|Log in/i,
  discardDraft: /Descartarla|Discard/i,
  preview: /Vista previa|Preview/i,
  share: /Compartir|Share/i,
  yourTeam: /Su equipo|Your team/i,
  drillIn: /Celda abierta|Open cell/i,
  submitAnswers: /Enviar mis respuestas|Enviar|Submit/i,
  openPlan: /^(Abrir|Open)$/i,
}

/**
 * Whether a step runs under `--only <prefix>`. Case-insensitive on both sides, whitespace
 * trimmed, so `--only 04` and `--only "04 results"` both pick step `04 results Q3 and
 * drill-in`. An empty or missing prefix selects everything.
 */
export function matchesOnly(name, only) {
  const prefix = String(only ?? '').trim().toLowerCase()
  if (!prefix) return true
  return String(name ?? '').trim().toLowerCase().startsWith(prefix)
}

/**
 * The link the live page prints for respondents: `/microclimates/<id>/respond`
 * (`MicroclimateLivePage.tsx`), with or without its origin. Deliberately NOT
 * `/microclimate-invitations/<token>`: that route records an `opened` step as it resolves, and
 * no rehearsal step visits it — step 14 must land on the route that only reads on mount.
 */
export const RESPOND_LINK = /(?:https?:\/\/[^\s]+?)?\/microclimates\/[^\s/]+\/respond\b/

/** The methods a read-only rehearsal lets the browser send. */
export const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Whether the browser may send this request. Reads always; anything else only in the one
 * step that opted into writing (10b). "Read-only" is enforced here rather than promised in a
 * header, because the pages are not: the wizard offers to DELETE a leftover draft, and
 * `MicroclimateInvitationPage` POSTs an `opened` step once its token resolves (a route no
 * rehearsal step visits — step 14 opens `/microclimates/<id>/respond`, which only reads on
 * mount). A blocked request is recorded against the step, so the morning can see what the
 * screen tried to do.
 */
export function allowRequest(method, { allowWrites = false } = {}) {
  return allowWrites === true || READ_METHODS.has(String(method ?? '').toUpperCase())
}

/**
 * The error code the guard aborts a blocked write with. Chromium reports it in the page's
 * console as `net::ERR_BLOCKED_BY_CLIENT`, which is how `isConsoleNoise` tells the guard's own
 * refusal from a request the product failed. Measured against a blackhole origin: a plain
 * `route.abort()` on a POST logs "Failed to load resource: net::ERR_FAILED", the same text a
 * dead API produces, and a step would FAIL for what the rehearsal did to it;
 * `route.abort('blockedbyclient')` logs "… net::ERR_BLOCKED_BY_CLIENT.Inspector".
 */
export const BLOCKED_ERROR_CODE = 'blockedbyclient'

/**
 * Console errors a step does not hold against the screen: the favicon the dev server has none
 * of, a navigation that cancelled a request in flight, the React DevTools banner, and the
 * guard's own abort of a write (already listed under `blocked writes`). Everything else —
 * `net::ERR_FAILED`, a 500, an uncaught TypeError — is the product's and fails the step.
 */
export function isConsoleNoise(text) {
  return /favicon|net::ERR_ABORTED|net::ERR_BLOCKED_BY_CLIENT|Download the React DevTools/.test(String(text ?? ''))
}

/**
 * The exit code for a finished run: 1 when any step failed or any teardown request was
 * refused (a session the run opened and could not close is residue on the tenant, and a run
 * that leaves it must not read as green), 2 when nothing ran at all (a `--only` that matched
 * no step must not read as green either), 0 otherwise.
 */
export function exitCode(results, teardownFailed = []) {
  if (!results?.length) return 2
  if ((teardownFailed?.length ?? 0) > 0) return 1
  return results.some((r) => r.status === 'FAIL') ? 1 : 0
}

/** Responses a survey needs before step 04 reads its results: enough to clear every floor. */
export const MIN_RESULTS_RESPONSES = 20

/**
 * The survey step 04 opens: any CLOSED survey with at least `MIN_RESULTS_RESPONSES`
 * responses, a `Q3` title first when the tenant has one (the runbook's wave), otherwise the
 * first that qualifies — the same rule `flows.mjs` uses for its results flow. It insisted on
 * a closed `Q3` and failed "no closed Q3" on every tenant but the one the runbook was written
 * on. Null when nothing qualifies.
 */
export function pickResultsSurvey(surveys, min = MIN_RESULTS_RESPONSES) {
  const closed = (surveys ?? []).filter((s) => s?.status === 'closed' && (s.responseCount ?? 0) >= min)
  return closed.find((s) => /Q3/.test(s.title ?? '')) ?? closed[0] ?? null
}

/** The title of the session `--open-microclimate` opens. Spanish, like the tenant. */
export const REHEARSAL_MICROCLIMATE_TITLE = 'Ensayo automatizado'

/**
 * The `POST /microclimates` body step 14 sends under `--open-microclimate` when the tenant has
 * no live session: one likert question, open from a minute ago for two hours, so the
 * `PUT /microclimates/{id}/status { status: 'active' }` that follows is inside its window.
 * The teardown closes it (`teardownRequests` in `flows-harness.mjs`).
 */
export function microclimateDraft(companyId, now = Date.now()) {
  return {
    title: REHEARSAL_MICROCLIMATE_TITLE,
    companyId,
    startTime: new Date(now - 60e3).toISOString(),
    endTime: new Date(now + 2 * 3600e3).toISOString(),
    targetParticipantCount: 10,
    anonymousResponses: true,
    timezone: 'America/Costa_Rica',
    questions: [{ text: '¿Cómo va la semana?', type: 'likert', required: true, order: 0 }],
  }
}
