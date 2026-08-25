import { parseReportDocument, type ReportDocument } from '../reportDocument'

/**
 * The public consumption side of a report share link (#139) —
 * `GET {baseUrl}/shared/reports/{token}`.
 *
 * ## This endpoint does not exist yet, and this module is written that way on purpose
 *
 * #91 shipped the report surface it shipped: `ReportEndpoints.cs` maps exactly four
 * routes, all under `app.MapGroup("/admin/reports").RequireAuthorization()`, and none of
 * them is token-addressed. Grepped, not assumed: nothing in `src/ClimateProject.Api`
 * contains the string `shared/reports`, `Report` carries no share-token column, and
 * `Report.SharedWith` is a `List<string>` that `SubjectDataMap` itself describes as
 * something "nothing populates yet".
 *
 * So today every call from here answers 404, and `SharedReportPage` renders its one
 * "not available" state — which is the correct and safe behaviour for a link nobody has
 * minted. The path is the legacy one the issue names (`api/shared/reports/[token]`), so
 * links printed by the system this replaces keep working when the endpoint lands.
 *
 * ## Why this is `fetch` and not `authFetch`
 *
 * Two reasons, the same two `features/surveys/api/surveyLinks.ts` records for the survey
 * link routes, and both are stronger here.
 *
 * **`authFetch` would destroy the page.** On any 401 it clears the stored token and sets
 * `window.location.href = '/login'`. The visitor to a shared report is by definition
 * somebody without a session; bouncing them to a sign-in form they cannot pass would
 * replace the "not available" sentence with a login screen, and worse, would sign out an
 * administrator who happened to open a share link in the browser they administer in.
 *
 * **And a bearer token would be a credential sent for nothing.** The token in the path
 * IS the credential. A share link is forwarded, pasted into chat and printed; attaching
 * the holder's session to it adds a second credential to a request that cannot use one.
 *
 * ## One error, carrying nothing
 *
 * See `SharedReportUnavailableError`. This is the client half of the acceptance
 * criterion that expired, revoked and invalid must be indistinguishable.
 */

/**
 * Every way a shared report can fail to load, as one type with no fields.
 *
 * ## Why it carries no status, no reason and no server message
 *
 * The issue's second acceptance criterion is that expired, revoked and invalid tokens
 * are indistinguishable *to the caller*, because telling them apart lets somebody
 * holding a list of guesses learn which ones were once real — token enumeration against
 * a page that serves a company's climate data to anyone with a URL.
 *
 * That is primarily the server's promise to keep. But a client is perfectly capable of
 * breaking it from this side, and the ways are mundane: an error class with a `status`
 * field invites `if (error.status === 410)`; an error carrying the response body's
 * `message` prints whatever sentence the server chose, and "this link was revoked" is a
 * disclosure however carefully the status codes were flattened.
 *
 * So the distinction is destroyed here, at the boundary, rather than merely left
 * unrendered by today's page. There is no field to branch on, so no future edit to
 * `SharedReportPage` can start branching without first changing this file — which is
 * exactly the review this decision deserves. `sharedReports.test.ts` pins it by asserting
 * that the rejections from 404, 410, 403 and a network failure are indistinguishable
 * from one another under `JSON.stringify` and property enumeration.
 *
 * Contrast `SurveyLinkError`, which deliberately carries `status` and `reason`: an
 * invitation is addressed to one named person who is entitled to know their own link was
 * revoked. A share link is held by anyone at all.
 */
export class SharedReportUnavailableError extends Error {
  constructor() {
    // A fixed, non-identifying message. Nothing renders it — `SharedReportPage` shows
    // translated copy — but an error that reaches a console or a log should not carry a
    // sentence that varies with the cause either.
    super('shared report unavailable')
    this.name = 'SharedReportUnavailableError'
  }
}

/**
 * A shared report as its public page renders it.
 *
 * Deliberately a small projection of `ReportDetail`, and the omissions are the point:
 * no `id`, no `companyId`, no `createdBy`, no `downloadCount`, no `status`. A share
 * link's holder is being shown a document, not the record that produced it — and
 * `companyId` and `createdBy` are the two fields that would let a holder correlate this
 * report with another tenant surface.
 */
export interface SharedReport {
  title: string
  description: string | null
  /** `Report.Type`: `summary`, `detailed`, `comparison`, `executive`. */
  type: string
  /** `Report.GenerationCompletedAt`. `null` for a report still being generated. */
  generatedAt: string | null
  /**
   * `reports.report_output`, already parsed. `null` when the column is empty or holds
   * something that is not a document — see `parseReportDocument`.
   */
  document: ReportDocument | null
}

/** The wire shape, before `reportOutput` is parsed. Mirrors `ReportDetail`'s subset. */
interface SharedReportWire {
  title?: unknown
  description?: unknown
  type?: unknown
  generatedAt?: unknown
  reportOutput?: unknown
}

/**
 * Resolves a share token into the report it opens.
 *
 * `encodeURIComponent` because this token comes straight out of the URL bar and is not
 * yet known to be one of ours: anything at all can be typed into a path segment, and it
 * must not be able to add segments of its own.
 *
 * @param options.lang the locale to resolve authored content in. Optional and last, per
 * the house rule — a prior bug put an optional `baseUrl` before required arguments and
 * broke five exports.
 *
 * @throws {SharedReportUnavailableError} for **every** failure: a dead token, a
 * rate-limited request, a 5xx, a body that is not an object, and a `fetch` that never
 * reached the network. One rejection for all of them, by construction.
 */
export async function getSharedReport(
  baseUrl: string,
  token: string,
  options: { lang?: string } = {},
): Promise<SharedReport> {
  const query = options.lang ? `?lang=${encodeURIComponent(options.lang)}` : ''
  const url = `${baseUrl}/shared/reports/${encodeURIComponent(token)}${query}`

  let response: Response
  try {
    response = await fetch(url)
  } catch {
    // A `TypeError` out of `fetch` — offline, DNS, CORS — is folded into the same
    // rejection as a dead token. It is not a disclosure risk in itself, but a second
    // outcome here is a second branch the page could grow, and the whole design of this
    // module is that there is exactly one.
    throw new SharedReportUnavailableError()
  }

  if (!response.ok) throw new SharedReportUnavailableError()

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new SharedReportUnavailableError()
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new SharedReportUnavailableError()
  }

  const wire = body as SharedReportWire
  return {
    title: typeof wire.title === 'string' ? wire.title : '',
    description: typeof wire.description === 'string' ? wire.description : null,
    type: typeof wire.type === 'string' ? wire.type : '',
    generatedAt: typeof wire.generatedAt === 'string' ? wire.generatedAt : null,
    document: parseReportDocument(
      typeof wire.reportOutput === 'string' ? wire.reportOutput : null,
    ),
  }
}
