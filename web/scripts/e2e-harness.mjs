/**
 * The pure parts of the live end-to-end harness, split out so they can be unit tested.
 * `e2e.mjs` starts a browser the moment it is imported; this file starts nothing.
 *
 * ## What this harness is for, and why `shot.mjs` is not it
 *
 * `shot.mjs` answers every API call from `scripts/shot-fixtures/*.json` and signs in with
 * an UNSIGNED token the real API would reject. That is correct for a screenshot — it makes
 * a screen reproducible — but it means no instrument in this repository has ever checked
 * that a screen works against the running backend. 87 test files stub `fetch` and assert
 * the page against a hand-written response; the fixtures are a second, unverified copy of
 * the API contract.
 *
 * This harness drives the real UI against the real API with a real signed token, and
 * records every request and response it sees. The recording is the deliverable: it is what
 * the fixtures can finally be checked against.
 */

/**
 * Every route path declared in `src/app/router.tsx`.
 *
 * ## Why this is parsed rather than listed
 *
 * A hand-maintained list of routes drifts, and drifts SILENTLY: the run stays green while
 * covering less and less, which is indistinguishable from covering everything. This
 * repository has already paid for that twice with the screenshot harness — it photographed
 * one viewport on every AdminLayout screen for months, and minted no `nodoId` claim for
 * months, and in both cases the instrument reported success throughout.
 *
 * So the router is the authority. `deriveMatrix` fails the run when the router declares a
 * path the coverage table does not mention, which converts "we forgot to cover the new
 * screen" from an invisible gap into a red run.
 *
 * Every path in this router is absolute and there are no index routes, so a regex over the
 * `path:` properties is exact rather than approximate. `assertRouterShape` below is what
 * keeps that assumption honest: it fails if the file ever gains a relative path or an
 * index route, rather than letting this parser quietly skip it.
 */
export function parseRouterPaths(source) {
  const paths = new Set()
  for (const match of source.matchAll(/\bpath:\s*'([^']*)'/g)) {
    paths.add(match[1])
  }
  return [...paths].sort()
}

/**
 * The parser above is only exact while the router keeps the shape it has today. This is the
 * tripwire for the day it does not: a relative path (`path: 'x'`) would be resolved against
 * a parent this parser never reads, and an index route declares no `path` at all, so both
 * would be silently under-covered rather than reported.
 */
export function assertRouterShape(source) {
  const problems = []
  if (/\bindex:\s*true/.test(source)) {
    problems.push('router declares an index route, which has no `path` for parseRouterPaths to find')
  }
  for (const match of source.matchAll(/\bpath:\s*'([^']*)'/g)) {
    if (!match[1].startsWith('/')) {
      problems.push(`router declares a relative path '${match[1]}', which is resolved against a parent this parser does not read`)
    }
  }
  return problems
}

/**
 * Cross the router's paths with the coverage table.
 *
 * `missing` is the one that fails a run. `unknown` — a coverage entry naming a path the
 * router no longer has — is reported too: it is not dangerous, but it is dead weight that
 * makes the table look more thorough than it is.
 */
export function deriveMatrix(routerPaths, coverage) {
  const declared = new Set(Object.keys(coverage))
  return {
    missing: routerPaths.filter((path) => !declared.has(path)),
    unknown: [...declared].filter((path) => !routerPaths.includes(path)).sort(),
    covered: routerPaths.filter((path) => declared.has(path)),
  }
}

/**
 * Substitute `:params` with real ids discovered from the API.
 *
 * Returns `null` when an id is not available, so the caller can report the route as
 * UNVISITED rather than navigate to a literal `/surveys/:id` — which renders a real screen
 * that fetches a survey called ":id", 404s, and shows an error state. That page would pass
 * a naive "did it render" check while proving nothing about the route.
 */
export function fillParams(path, ids) {
  const params = [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1])
  if (params.length === 0) return path

  let filled = path
  for (const param of params) {
    const value = ids[param]
    if (value === undefined || value === null || value === '') return null
    filled = filled.replace(`:${param}`, encodeURIComponent(value))
  }
  return filled
}

/**
 * A console message worth failing on.
 *
 * Vite's dev server, React's devtools nag and the browser's own deprecation notices are
 * noise that would otherwise make every route red and the report worthless. Everything
 * else is kept: an app that logs an error while rendering has something wrong with it.
 */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[vite\]/i,
  /was preloaded using link preload but not used/i,
  // The browser's own echo of an HTTP status, not the application saying anything.
  // Chrome logs "Failed to load resource: the server responded with a status of 403"
  // for EVERY non-2xx, including the ones a screen handles correctly and by design —
  // a leader refused /action-plans, a super_admin refused the tracking service. The
  // response listener already classifies every one of those against the route's
  // declared expectations, so keeping them here does not add a signal; it doubles
  // every expected refusal into two reported problems and trains the reader to skim
  // past the report. A genuine 500 is still caught, by the classifier that should
  // catch it.
  /^Failed to load resource:/i,
]

export function isSignificantConsoleError(text) {
  if (!text) return false
  return !IGNORED_CONSOLE.some((pattern) => pattern.test(text))
}

/**
 * Which entity a route's `:id` actually names.
 *
 * `:id` is not one thing. It is a survey under `/surveys/:id`, a microclimate under
 * `/microclimates/:id`, an action plan under `/action-plans/:id`, a company under
 * `/admin/companies/:id`, a template under `/surveys/templates/:id` and a plan de acción
 * under `/tracking/planes/:id`. Substituting one pool of ids by parameter NAME would send
 * a survey id to the microclimate route, which answers 404 and renders a perfectly
 * healthy-looking "not found" screen — a false pass that is worse than a skip, because it
 * is indistinguishable from a real one in the report.
 *
 * Longest prefix wins, so `/surveys/templates/:id` is matched before `/surveys/:id`.
 */
const ID_OWNERS = [
  ['/surveys/templates/', 'template'],
  ['/admin/companies/', 'company'],
  ['/action-plans/', 'actionPlan'],
  ['/microclimates/', 'microclimate'],
  ['/tracking/planes/', 'plan'],
  ['/surveys/', 'survey'],
]

export function resolveIds(routePattern, discovered) {
  const owner = ID_OWNERS
    .filter(([prefix]) => routePattern.startsWith(prefix))
    .sort((a, b) => b[0].length - a[0].length)[0]

  return {
    ...discovered,
    // `:companyId` and `:surveyId` are already unambiguous and pass straight through.
    id: owner ? discovered[owner[1]] : undefined,
  }
}

/**
 * The key structure of a JSON value, with every leaf replaced by its type.
 *
 * This is what a fixture can be checked against. A fixture is right or wrong about the
 * SHAPE of a response — which keys exist, whether a field is a list, whether a nullable
 * came back null — and wrong about nothing else, because its values are invented anyway.
 *
 * Recording shapes rather than bodies also means the journal holds no names, no email
 * addresses and no free-text answers, so it can be read and diffed without handling
 * anybody's survey response. On a product whose central promise is anonymity, a debugging
 * artefact full of real answers is a liability that would eventually be pasted somewhere.
 *
 * Arrays collapse to their FIRST element's shape. A list of a thousand rows and a list of
 * one describe the same contract, and the difference between them is data, not shape.
 */
export function shapeOf(value, depth = 0) {
  if (depth > 6) return '…'
  if (value === null) return 'null'
  if (Array.isArray(value)) return value.length === 0 ? [] : [shapeOf(value[0], depth + 1)]
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, shapeOf(value[key], depth + 1)]),
    )
  }
  return typeof value
}

/** Flatten a shape to dotted paths, so two shapes diff as sets of strings. */
/**
 * Flatten a shape to dotted paths, so two shapes diff as sets of strings.
 *
 * A bare `prefix[]` means an EMPTY array — one side having nothing to say about the
 * element shape — and is deliberately distinct from `prefix[].field`, so the caller can
 * tell "the shapes differ" from "there was nothing to compare". Conflating those two is
 * what made the first drift report forty lines of noise around three real findings.
 */
export function flatten(shape, prefix = '') {
  if (Array.isArray(shape)) {
    return shape.length === 0 ? [`${prefix}[]`] : flatten(shape[0], `${prefix}[]`)
  }
  if (shape !== null && typeof shape === 'object') {
    return Object.entries(shape).flatMap(([key, value]) =>
      flatten(value, prefix ? `${prefix}.${key}` : key))
  }
  return [`${prefix}: ${shape}`]
}
