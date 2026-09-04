import { authFetch } from '../../../api/authFetch'

/**
 * The administrator side of a report share link — `ReportShareEndpoints.cs`.
 *
 * ## Why this is a separate module from `sharedReports.ts`
 *
 * They are opposite halves of #139 and they must not share a transport. `sharedReports.ts`
 * calls the PUBLIC route with a bare `fetch`, deliberately: `authFetch` clears the stored
 * token and navigates to `/login` on a 401, which would sign an administrator out of the
 * browser they administer in the moment they opened a share link in it. These three routes
 * are the mirror image — `/admin/reports/**`, authorized, mutating, audited — so they use
 * `authFetch` and every one of them needs the bearer header.
 *
 * ## The token is readable exactly once
 *
 * `POST /admin/reports/{id}/share` is the only response that ever carries it:
 * `report_shares` stores a SHA-256 hash (`ReportShareTokens.cs`), so nothing can recover the
 * value afterwards — not this module, not the list route, not the database. `ReportShareSummary`
 * carries no token and no hash by design. That is why `ReportSharePanel` shows the URL with a
 * statement that it cannot be shown again, and why the remedy for a lost link is a new mint
 * and a revoke rather than a reveal.
 */

/** Body of the mint. Every field optional — see `CreateReportShareRequest`. */
export interface CreateReportShareInput {
  /**
   * Days the link should live.
   *
   * Omitted takes the server's default of 30 (`ReportShareTokens.DefaultLifetimeDays`), and
   * an out-of-range value is CLAMPED to [1, 365] rather than rejected — `ClampLifetimeDays`
   * records why: the caller is an administrator picking a duration, not an attacker probing a
   * parser. So the response's `expiresAt` is the authority on what was actually minted, and
   * the panel reads it back rather than computing the date it asked for.
   */
  expiresInDays?: number
}

/** The mint response — see `CreateReportShareResponse`. */
export interface CreateReportShareResult {
  id: string
  /** The share token. Belongs in a URL, not in a log, and never rendered on its own. */
  token: string
  /**
   * The path the token opens, `/shared/reports/{token}`, built server-side so the API and
   * `router.tsx` cannot drift. The ORIGIN is not included, because the API does not know
   * which of its front ends is asking — the caller prepends `window.location.origin`.
   */
  path: string
  expiresAt: string
}

/** A minted link as the admin surface lists it — see `ReportShareSummary`. No token, no hash. */
export interface ReportShareSummary {
  id: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  accessCount: number
  lastAccessedAt: string | null
  /** Whether this link resolves right now: not revoked, not expired. Computed server-side. */
  isActive: boolean
}

export async function createReportShare(
  baseUrl: string,
  reportId: string,
  input: CreateReportShareInput = {},
): Promise<CreateReportShareResult> {
  const response = await authFetch(`${baseUrl}/admin/reports/${reportId}/share`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return response.json() as Promise<CreateReportShareResult>
}

export async function listReportShares(
  baseUrl: string,
  reportId: string,
): Promise<ReportShareSummary[]> {
  const response = await authFetch(`${baseUrl}/admin/reports/${reportId}/shares`)
  return response.json() as Promise<ReportShareSummary[]>
}

/**
 * Revokes one link. Idempotent server-side (204 whether or not it was already revoked) and
 * scoped to the report in the path, so a share id from another report cannot be revoked
 * through this one.
 */
export async function revokeReportShare(
  baseUrl: string,
  reportId: string,
  shareId: string,
): Promise<void> {
  await authFetch(`${baseUrl}/admin/reports/${reportId}/shares/${shareId}`, { method: 'DELETE' })
}

/**
 * The absolute URL to hand somebody.
 *
 * `origin` is passed in rather than read from `window` so the function is testable and so a
 * caller cannot accidentally build a link against a different origin than the one the user is
 * looking at. The server deliberately returns only the path.
 */
export function shareLinkUrl(origin: string, path: string): string {
  return `${origin}${path}`
}
