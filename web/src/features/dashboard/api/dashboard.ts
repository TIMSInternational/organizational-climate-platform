import { authFetch } from '../../../api/authFetch'

/**
 * Typed client for `/dashboard/*` (DashboardEndpoints.cs) — the four role dashboards (#132).
 *
 * **Four functions, four shapes, and no union.** The server deliberately does not offer a
 * single "dashboard" payload with optional sections, because that would put every tenant's
 * figures on the wire for anyone reading the network tab. Modelling them here as one type
 * with optional fields would hand that shape back at the client, and the first page to
 * write `data.companies?.length` would be reading a field its caller's role can never
 * populate. So each role's payload is its own interface, and choosing between them is a
 * routing decision made once, in `DashboardPage`.
 *
 * Nothing here filters. Every count and every row arrives already scoped by the server; if
 * a figure is on this payload the caller is permitted to see it.
 */

/** A survey on an admin dashboard — `DashboardSurveySummary` in DashboardDtos.cs. */
export interface DashboardSurveySummary {
  id: string
  /** Already resolved for the requested locale, and null when the title is absent in every language. */
  title: string | null
  status: string
  startDate: string
  endDate: string
  responseCount: number
  targetAudienceCount: number | null
}

/**
 * A survey on a department's dashboard — `DashboardDepartmentSurveySummary` in DashboardDtos.cs.
 *
 * Not {@link DashboardSurveySummary}, and the missing `targetAudienceCount` is the point.
 * That shape's two participation columns come off the survey row, where `responseCount` is
 * bumped once per completed response *anywhere in the tenant* and `targetAudienceCount` is
 * the tenant's invited headcount. On a page contracted to one department both describe every
 * other department too, so the server counts this department's responses instead and offers
 * no target at all: the schema has no per-department invited headcount to offer.
 */
export interface DashboardDepartmentSurveySummary {
  id: string
  title: string | null
  status: string
  startDate: string
  endDate: string
  /** Completed responses from this department alone. */
  responseCount: number
}

/** One tenant on the platform overview — SuperAdmin payloads only. */
export interface DashboardCompanySummary {
  id: string
  name: string
  userCount: number
  activeSurveyCount: number
  completedResponseCount: number
  createdAt: string
}

/**
 * One department's headcount and response total.
 *
 * **Not a participation rate, and the two fields must not be divided.**
 * `DashboardQueries.DepartmentSummaries` counts the responses with no survey
 * predicate — `r.DepartmentId == d.Id && r.CompanyId == companyId &&
 * r.IsComplete` — so `completedResponseCount` is a running total across every
 * survey the department has ever been sent, while `memberCount` is the headcount
 * today. Their quotient passes 1 on a company's second survey and keeps climbing.
 *
 * The list is also capped: `DashboardEndpoints.cs` passes
 * `DepartmentRowLimit = 12`, so on a larger company most departments have no row
 * here at all. An absent department is one that was not reported on, which is not
 * the same claim as one that reported nothing — see `DepartmentList.tsx`.
 */
export interface DashboardDepartmentSummary {
  id: string
  name: string
  memberCount: number
  completedResponseCount: number
}

/** `GET /dashboard/super-admin`. Every figure spans all tenants. */
export interface SuperAdminDashboard {
  companyCount: number
  userCount: number
  activeUserCount: number
  surveyCount: number
  activeSurveyCount: number
  responseCount: number
  completedResponseCount: number
  companies: DashboardCompanySummary[]
}

/** `GET /dashboard/company-admin`. One tenant. */
export interface CompanyAdminDashboard {
  companyId: string
  companyName: string
  userCount: number
  activeUserCount: number
  departmentCount: number
  surveyCount: number
  activeSurveyCount: number
  draftSurveyCount: number
  responseCount: number
  completedResponseCount: number
  openActionPlanCount: number
  overdueActionPlanCount: number
  ongoingSurveys: DashboardSurveySummary[]
  departments: DashboardDepartmentSummary[]
}

/** `GET /dashboard/department-admin`. One department. */
export interface DepartmentAdminDashboard {
  departmentId: string
  departmentName: string
  companyId: string
  memberCount: number
  activeMemberCount: number
  activeSurveyCount: number
  completedResponseCount: number
  openActionPlanCount: number
  overdueActionPlanCount: number
  activeSurveys: DashboardDepartmentSurveySummary[]
}

/**
 * A survey the caller still owes an answer to.
 *
 * Narrower than {@link DashboardSurveySummary} on purpose, exactly as `/surveys/my` is
 * narrower than `/surveys`: a respondent is not told how many other people have answered.
 */
export interface DashboardPendingSurvey {
  id: string
  title: string | null
  type: string
  startDate: string
  endDate: string
  questionCount: number
  /**
   * The survey's own `Settings.Anonymous` — the same field `/surveys/{id}/respond` sends as
   * `SurveyRespondView.anonymous`, from the same column.
   *
   * **Only `true` may be rendered as a promise.** A card that showed an "Anonymous" chip for
   * a survey that records who answered would be this product's worst possible sentence, and
   * `false` has no chip of its own: "Not anonymous" belongs on the respond page, where the
   * reader is about to answer and the full explanation is beside it. Here it is silence.
   */
  anonymous: boolean
}

/** `GET /dashboard/employee`. Scoped to the caller's own user row and to nobody else's. */
export interface EmployeeDashboard {
  name: string
  /** Null for a user who belongs to no tenant — a global super_admin (#191). */
  companyId: string | null
  departmentId: string | null
  departmentName: string | null
  pendingSurveyCount: number
  completedSurveyCount: number
  unreadNotificationCount: number
  /** The soonest close date across ALL pending surveys, not merely the listed page of them. */
  nextDeadline: string | null
  pendingSurveys: DashboardPendingSurvey[]
}

/**
 * One action plan opened since the last survey closed — `DashboardPlanOpened` in
 * DashboardDtos.cs.
 *
 * **A null `departmentName` is an answer, not missing data**, and the server is careful to
 * leave two cases indistinguishable behind it: the plan is company-wide and has no
 * department at all, or it belongs to a department that was *protected* in that survey's
 * results. A client that treated null as "unknown" and went looking for the name elsewhere
 * would undo the suppression the null exists to perform — so the only correct rendering of
 * a nameless row is a row with no name on it.
 */
export interface DashboardPlanOpened {
  departmentName: string | null
  createdAt: string
}

/**
 * `GET /dashboard/employee/last-outcome` — "what came of the last one".
 *
 * **Counts and dates, and deliberately nothing that could hold a score.** An employee is
 * not authorized for `/surveys/{id}/results`, so this payload is not permitted to be the
 * side door around it: there is no per-question, per-segment or per-dimension figure here,
 * and not even a per-department response count. What it carries is the *shape* of what
 * happened, every part of which is knowable without knowing who answered.
 *
 * `protectedDepartmentCount` is a count and never a list, for the reason a department falls
 * below the floor in the first place — at that size the group is the person. A renderer may
 * say how many were withheld and must never say which, and `minimumGroupSize` is sent so it
 * can say *why* in the same breath (rather than hardcoding a 5 that
 * `SurveyResultsPrivacy.MinimumSegmentRespondents` is free to change).
 */
export interface EmployeeLastOutcome {
  surveyId: string
  /** Already resolved for the requested locale; null when absent in every language. */
  surveyTitle: string | null
  closedOn: string
  /** Completed responses company-wide. A tenant-wide count identifies nobody. */
  responseCount: number
  /** Departments that answered at all, protected ones included. */
  departmentCount: number
  /** How many of those were withheld for being below the floor. Never their names. */
  protectedDepartmentCount: number
  minimumGroupSize: number
  /**
   * A bounded page of the still-open plans opened after the survey closed, oldest first —
   * a short narrative of what happened next, not a directory. {@link openPlanCount} is the
   * full tally of the same population, so it may exceed this list's length.
   */
  plansOpenedSince: DashboardPlanOpened[]
  openPlanCount: number
}

function withQuery(baseUrl: string, path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value)
    }
  }
  const query = search.toString()
  return query ? `${baseUrl}${path}?${query}` : `${baseUrl}${path}`
}

/** Takes no locale: nothing on the platform overview is authored content. */
export async function getSuperAdminDashboard(baseUrl: string): Promise<SuperAdminDashboard> {
  const response = await authFetch(`${baseUrl}/dashboard/super-admin`)
  return response.json() as Promise<SuperAdminDashboard>
}

/**
 * `companyId` is required for a SuperAdmin (the server answers 400 without one) and
 * **ignored** for a CompanyAdmin, whose own claim decides the scope. Passing another
 * tenant's id as a CompanyAdmin is a 403, not a silent substitution — see
 * `CompanyAdminAsync`.
 */
export async function getCompanyAdminDashboard(
  baseUrl: string,
  options: { companyId?: string; lang?: string } = {},
): Promise<CompanyAdminDashboard> {
  const response = await authFetch(
    withQuery(baseUrl, '/dashboard/company-admin', { companyId: options.companyId, lang: options.lang }),
  )
  return response.json() as Promise<CompanyAdminDashboard>
}

/**
 * `departmentId` is omitted by a leader or supervisor — the server reads their own user
 * row, because department membership moves and a token minted before a transfer would keep
 * serving the old team. It is required for the two admin roles, who have no department of
 * their own.
 */
export async function getDepartmentAdminDashboard(
  baseUrl: string,
  options: { departmentId?: string; lang?: string } = {},
): Promise<DepartmentAdminDashboard> {
  const response = await authFetch(
    withQuery(baseUrl, '/dashboard/department-admin', {
      departmentId: options.departmentId,
      lang: options.lang,
    }),
  )
  return response.json() as Promise<DepartmentAdminDashboard>
}

export async function getEmployeeDashboard(baseUrl: string, lang?: string): Promise<EmployeeDashboard> {
  const response = await authFetch(withQuery(baseUrl, '/dashboard/employee', { lang }))
  return response.json() as Promise<EmployeeDashboard>
}

/**
 * `null` is a normal, successful answer and not an error.
 *
 * The endpoint sends the four bytes `null` at 200 when the caller's company has never
 * closed a survey (or belongs to no company at all). Its own remark says why that beats a
 * 404 or a zero-filled shape: **the panel is absent, not empty**, and a payload of zeroes
 * would render as "0 answers across 0 departments" — a sentence about a survey that never
 * happened. So the return type is nullable and the caller's job on null is to draw nothing.
 *
 * Takes the locale for the same reason {@link getEmployeeDashboard} does: the survey title
 * is authored content, resolved server-side per language.
 */
export async function getEmployeeLastOutcome(
  baseUrl: string,
  lang?: string,
): Promise<EmployeeLastOutcome | null> {
  const response = await authFetch(withQuery(baseUrl, '/dashboard/employee/last-outcome', { lang }))
  return response.json() as Promise<EmployeeLastOutcome | null>
}
