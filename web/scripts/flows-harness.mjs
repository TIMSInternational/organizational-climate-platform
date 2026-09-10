/**
 * The decisions `flows.mjs` makes about what to reuse and what to put back — pure, so they
 * can be checked without a stack and without a browser (`flows-harness.test.mjs`).
 *
 * Why this exists: the driver used to create a department `Calidad NNN`, a plan
 * `Plan de prueba NNNN` and a report share link on every run, and its teardown could only
 * deactivate the department and cancel the plan, because neither can be deleted (by design)
 * and it never revoked the link at all. The client-facing demo tenant accumulated six inactive
 * departments, three cancelled plans and six live share links, each renamed or revoked by hand.
 *
 * The rule now: ONE department by a fixed name and ONE plan by a fixed title, created only when
 * absent and reused otherwise (reactivated / reopened first if a previous teardown left them
 * inactive / cancelled); every share link the run minted is revoked; a test survey that cannot
 * be deleted because someone answered it is closed and archived instead of being left open.
 */

/** The driver's own department. Spanish, because the tenant it must not litter is. */
export const FIXED_DEPARTMENT_NAME = 'Prueba automatizada'
/** The driver's own action plan. */
export const FIXED_PLAN_TITLE = 'Plan de prueba automatizada'

/**
 * Finds the driver's department in `GET /admin/departments` (which lists inactive rows too —
 * `DepartmentEndpoints.ListAsync` filters on company only). `reactivate` says whether the
 * previous teardown's `PUT { isActive: false }` has to be undone before the flow can list it.
 */
export function findFixedDepartment(departments, name = FIXED_DEPARTMENT_NAME) {
  const match = (departments ?? []).find((d) => d?.name === name)
  return match ? { id: match.id, reactivate: match.isActive === false } : null
}

/**
 * Finds the driver's plan in `GET /action-plans?companyId=` (unfiltered, so cancelled rows are
 * returned). `reopen` says whether the previous teardown's cancel has to be undone;
 * `ActionPlanEndpoints.UpdateAsync` applies any valid status, there is no transition table.
 */
export function findFixedPlan(plans, title = FIXED_PLAN_TITLE) {
  const match = (plans ?? []).find((p) => p?.title === title)
  return match ? { id: match.id, reopen: match.status === 'cancelled' } : null
}

/** The only response that ever carries a share id: `POST /admin/reports/{id}/share`. */
export const MINT_PATH = /\/admin\/reports\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/share(?:[?#]|$)/i

/**
 * Reads `{ reportId, shareId }` out of the mint the page just made, so the teardown can call
 * `DELETE /admin/reports/{reportId}/shares/{shareId}` (`reportShares.ts` — revoke is scoped to
 * the report in the path). Null when the URL is not the mint or the body carries no id.
 */
export function shareFromMint(url, body) {
  const match = MINT_PATH.exec(String(url ?? ''))
  if (!match || typeof body?.id !== 'string' || !body.id) return null
  return { reportId: match[1], shareId: body.id }
}

const json = { 'Content-Type': 'application/json' }

/**
 * The requests that put the tenant back, in order, through the same endpoints the UI uses.
 * Each is `{ kind, id, method, path, body?, done }` where `done` is the word for the log
 * when it succeeds. Shares first: a public link is the one row here that is reachable
 * without a session, so it is the one a crash further down must not leave behind.
 */
export function teardownRequests(created) {
  const c = { surveys: [], plans: [], departments: [], shares: [], ...(created ?? {}) }
  return [
    ...c.shares.map(({ reportId, shareId }) => ({
      kind: 'share', id: shareId, method: 'DELETE', path: `/admin/reports/${reportId}/shares/${shareId}`, done: 'revoked',
    })),
    ...c.surveys.map((id) => ({ kind: 'survey', id, method: 'DELETE', path: `/surveys/${id}`, done: 'deleted' })),
    ...c.plans.map((id) => ({
      kind: 'plan', id, method: 'PUT', path: `/action-plans/${id}`, body: { status: 'cancelled' }, headers: json, done: 'cancelled',
    })),
    ...c.departments.map((id) => ({
      kind: 'department', id, method: 'PUT', path: `/admin/departments/${id}`, body: { isActive: false }, headers: json, done: 'deactivated',
    })),
  ]
}

/**
 * What to do when a teardown request did not succeed. Only one case has an answer: a survey
 * DELETE is refused with 409 once it holds a response (`SurveyEndpoints.DeleteSurveyAsync` —
 * "Archive it instead"), and the lifecycle table (`SurveyStatuses.Transitions`) allows
 * `active -> closed -> archived`, so the survey is walked there rather than left open on every
 * employee's dashboard. Everything else gets an empty list and is reported as a failure.
 */
export function teardownFallback(request, status) {
  if (request?.kind !== 'survey' || request.method !== 'DELETE' || status !== 409) return []
  const path = `/surveys/${request.id}/status`
  return [
    { kind: 'survey', id: request.id, method: 'PUT', path, body: { status: 'closed' }, headers: json, done: 'closed' },
    { kind: 'survey', id: request.id, method: 'PUT', path, body: { status: 'archived' }, headers: json, done: 'archived (it had responses)' },
  ]
}

/**
 * One line for the log and the list of what is still on the tenant. An outcome is a request
 * plus the `status` its last attempt returned; anything outside 2xx is residue, and the
 * driver's exit code must say so — a teardown that logs a count and returns 0 whatever the
 * server answered is exactly how the six departments got there.
 */
export function summariseTeardown(outcomes) {
  const failed = (outcomes ?? []).filter((o) => !(o.status >= 200 && o.status < 300))
  const counts = new Map()
  for (const o of outcomes ?? []) {
    if (failed.includes(o)) continue
    const key = `${o.kind} ${o.done}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const parts = [...counts].map(([key, n]) => `${n} ${key}`)
  const head = `teardown: ${parts.length ? parts.join(', ') : 'nothing to put back'}`
  const tail = failed.map((o) => `${o.method} ${o.path} -> ${o.status}`)
  return { line: tail.length ? `${head}; RESIDUE LEFT: ${tail.join('; ')}` : head, failed }
}
