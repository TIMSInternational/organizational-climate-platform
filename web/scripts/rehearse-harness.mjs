/**
 * The part of `rehearse.mjs` that can be checked without a browser
 * (`rehearse-harness.test.mjs`): which steps a `--only` prefix selects, what the run's exit
 * code says, and the accessible names it clicks by.
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
  yourTeam: /Tu equipo|Your team/i,
  drillIn: /Cada pregunta se compara|compared/i,
  submitAnswers: /Enviar mis respuestas|Enviar|Submit/i,
  openPlan: /Programa|Reponer|Rotación|Reuniones|Plan/i,
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

/** The methods a read-only rehearsal lets the browser send. */
export const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Whether the browser may send this request. Reads always; anything else only in the one
 * step that opted into writing (10b). "Read-only" is enforced here rather than promised in a
 * header, because the pages are not: `MicroclimateInvitationPage` POSTs an `opened` step the
 * moment it mounts, and the wizard offers to DELETE a leftover draft. A blocked request is
 * recorded against the step, so the morning can see what the screen tried to do.
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
 * The exit code for a finished run: 1 when any step failed, 2 when nothing ran at all (a
 * `--only` that matched no step must not read as green), 0 otherwise.
 */
export function exitCode(results) {
  if (!results?.length) return 2
  return results.some((r) => r.status === 'FAIL') ? 1 : 0
}
