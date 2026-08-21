// The one place in web/src that actually reads VITE_TRACKING_API_BASE_URL. Every
// trackingApi.ts export defaults its `baseUrl` parameter to this, so the env var is wired
// up end-to-end (not just documented in web/.env.example).
// Callers can still pass an explicit baseUrl (e.g. tests, or a page that needs a
// different environment) to override this default.
//
// #125 added the second reader below, `isTrackingEnabled`, and it is here rather than
// beside the nav so this stays the ONE module that touches the variable.
export function getTrackingApiBaseUrl(): string {
  return import.meta.env.VITE_TRACKING_API_BASE_URL as string
}

/**
 * Whether this deployment has a tracking service at all.
 *
 * ## What this is, and what it is deliberately not
 *
 * It is a **capability** flag: does a `services/tracking-api` exist for this build to
 * talk to. It is NOT company scoping, and the distinction matters because the house
 * rule is that company scoping comes from JWT claims and never from an env var.
 * Nothing here decides *which* tenant's data is shown — the tracking service does
 * that itself, from the caller's own `companyId` claim, via
 * `MatchingTenantRequirement(ProcomerCompanyId)`. This only decides whether the
 * module's pages are offered in the sidebar at all, which is a property of the
 * deployment and has no other source: a browser cannot discover that an origin
 * exists without asking it, and a nav rail that fired a request per render to find
 * out would be worse in every way.
 *
 * ## Why the base URL is the signal rather than a flag of its own
 *
 * A second variable (`VITE_TRACKING_ENABLED`) could disagree with this one, and the
 * failure mode of that disagreement is a sidebar entry whose page cannot reach
 * anything. There is exactly one fact — "is there a tracking API configured" — so
 * there is one variable.
 *
 * Undefined, empty and whitespace all read as "no". `import.meta.env` is typed as
 * `string` for a declared variable but an unset one is genuinely `undefined` at
 * runtime, which is why this does not just call `.trim()` on the result.
 */
export function isTrackingEnabled(): boolean {
  const baseUrl: unknown = getTrackingApiBaseUrl()
  return typeof baseUrl === 'string' && baseUrl.trim() !== ''
}
