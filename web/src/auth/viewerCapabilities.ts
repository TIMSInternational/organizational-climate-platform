import { useMemo } from 'react'
import { readSessionClaims, type CompanyScope } from '../company-context/companyContext'
import { useCompanyScope } from '../company-context/useCompanyScope'
import { canManagePlan, readTrackingClaims } from '../features/tracking/trackingAccess'

/**
 * What the signed-in viewer may do, as the server rules it — the one seam every
 * redesigned screen reads before it draws an action, a section or a picker.
 *
 * ## Why this exists
 *
 * A control that exists and then 403s is worse than one never offered: it invites a
 * click, and the refusal that follows reads as a bug rather than as a rule
 * (`features/tracking/pages/PlanDeAccionDetailPage.tsx`, module comment). Before this
 * module each screen re-derived "may I show this?" from the role claim by hand, and
 * three of them got it differently. Here every capability mirrors ONE server check and
 * cites it, so a screen that reads this seam agrees with the endpoint it will call.
 *
 * ## What this is not
 *
 * Not a permission check. The API re-evaluates every one of these on every request
 * (`CanAdminister`, `CanAccessCompany`, `PlanAccessHandler`) and would refuse a
 * mismatched call regardless of what this returns. This is the client agreeing with
 * the boundary, never the boundary.
 *
 * ## The role set
 *
 * `ClimateProject.Application.Auth.Roles` (`src/ClimateProject.Application/Auth/Roles.cs`)
 * is exactly `super_admin | company_admin | leader | supervisor | employee`, and
 * `Roles.Admin` is `[super_admin, company_admin]`. There is no `department_admin`.
 *
 * ## The "admin with a company" shape
 *
 * Almost every write on the API is gated by the same two lines:
 *
 * ```
 * currentUser.Role == Roles.SuperAdmin
 *   || (currentUser.Role == Roles.CompanyAdmin && currentUser.CompanyId == companyId.ToString())
 * ```
 *
 * (`SurveyEndpoints.cs:55-57` as `CanAdminister`; `CanAccessCompany` in
 * `ActionPlanEndpoints.cs:24-26`, `MicroclimateEndpoints.cs:134-136`,
 * `ReportShareEndpoints.cs:113-115`, `TrackingPickerEndpoints.cs:19-21`,
 * `DepartmentEndpoints.cs:24-26`.) The `companyId` compared is the one the request
 * names, so the client-side mirror is "an admin role, AND a company to name" — which is
 * exactly `CompanyScope.status === 'ready'` (`company-context/companyContext.ts`): a
 * `company_admin` whose token names a tenant, or a `super_admin` who has picked one.
 * A `super_admin` with nothing selected can author nothing, because there is no
 * `companyId` to put in the request; a `company_admin` with no tenant claim can never
 * satisfy the equality. Both come out `false` here, as the server would answer 403.
 */

export interface ViewerClaims {
  /** The `role` claim, or `undefined` when there is no readable token. */
  role: string | undefined
  /** The `companyId` claim, normalised so `''` reads as `undefined` (`readSessionClaims`). */
  companyId: string | undefined
  /** The `sub` claim — the tracking service's `PersonaExternalId`; `''` when absent. */
  personaExternalId: string
  /** The `nodoId` claim — `''` for a caller who leads no node (`JwtTokenService` mints it so). */
  nodoExternalId: string
}

export interface ViewerCapabilities {
  /**
   * The viewer's home surface is the whole tenant: `super_admin` with a company chosen,
   * or `company_admin`. Mirrors `GET /dashboard/company-admin`
   * (`DashboardEndpoints.cs:350-381`) and `DashboardPage.tsx`'s role map.
   */
  seesWholeCompany: boolean
  /**
   * The viewer's home surface is one department: `leader` or `supervisor`. Mirrors
   * `GET /dashboard/department-admin` (`DashboardEndpoints.cs:454-457`, `runsADepartment`)
   * and `DashboardPage.tsx`, which sends both roles to the department view.
   */
  seesTeam: boolean
  /**
   * The viewer's home surface is themselves: `employee`, and any unrecognised or absent
   * role. `GET /dashboard/employee` reads no role claim at all (`DashboardEndpoints.cs:105`),
   * which is why `DashboardPage.tsx` makes it the one safe default.
   */
  seesOnlySelf: boolean
  /** `POST /surveys` — `SurveyEndpoints.cs:306-310` via `CanAdminister` (`:55-57`). */
  canAuthorSurveys: boolean
  /** `POST /microclimates` — `MicroclimateEndpoints.cs:347` (`Roles.Admin` + `CanAccessCompany`). */
  canLaunchMicroclimate: boolean
  /** `POST /action-plans` — `ActionPlanEndpoints.cs:103` (`Roles.Admin` + `CanAccessCompany`). */
  canCreateActionPlan: boolean
  /** `/admin/reports/{id}/share` — `ReportShareEndpoints.cs:113-115` (`CanAccessCompany`). */
  canShareReports: boolean
  /**
   * Some export endpoint answers this viewer with a file. An admin with a company:
   * `/surveys/{id}/export*` (`SurveyExportEndpoints.cs:185` loads through
   * `SurveyResultsEndpoints.LoadAsync`, whose guard is `CanAdminister`,
   * `SurveyResultsEndpoints.cs:346-349`) and `/dashboard/company-admin/export`
   * (`DashboardEndpoints.cs:121`). A `leader` or `supervisor`:
   * `/dashboard/department-admin/export` (`DashboardEndpoints.cs:124`, gated at `:454-457`).
   * An `employee` has none.
   */
  canExport: boolean
  /**
   * Company settings and departments: `PUT /admin/companies/{id}/settings`
   * (`CompanyEndpoints.cs:218`, `Roles.Admin` and own company unless `super_admin`) and
   * `/admin/departments` (`DepartmentEndpoints.cs:24-26`, `:37`).
   */
  canManageOrg: boolean
  /**
   * The tracking directory pickers are admin-only: `TrackingPickerEndpoints.cs:19-21`
   * (`CanAccessCompany`), refused at `:30-32` and `:54-56`.
   */
  canUseDirectoryPickers: boolean
  /**
   * `avance`, `cumplir`, `involucrados` on a tracking plan: an admin, or the `leader`
   * whose `nodoId` claim equals the plan's node. Delegates to `trackingAccess.canManagePlan`,
   * which mirrors `ClimateTracking.Application.Auth.PlanAccessHandler` claim for claim —
   * one answer, not two lists that can drift.
   */
  canRecordProgress: (plan: { nodoExternalId: string }) => boolean
  /**
   * `GET /surveys/{id}/results` — `SurveyResultsEndpoints.cs:199-202` via `CanAdminister`
   * (`SurveyEndpoints.cs:55-57`): a `super_admin` for any survey, a `company_admin` only
   * for a survey of the tenant their **claim** names. The claim, not the selection: the
   * server compares `currentUser.CompanyId`, and `resolveCompanyScope` ignores a stored
   * selection for this role anyway.
   */
  canOpenResults: (survey: { companyId: string }) => boolean
}

const SUPER_ADMIN = 'super_admin'
const COMPANY_ADMIN = 'company_admin'
const LEADER = 'leader'
const SUPERVISOR = 'supervisor'

/** `Roles.Admin` — `super_admin` or `company_admin`. */
function isAdminRole(role: string | undefined): boolean {
  return role === SUPER_ADMIN || role === COMPANY_ADMIN
}

/**
 * The whole rule set, pure, so the table test can run it against every role without a
 * DOM. `scope` is the resolved company scope (`resolveCompanyScope`), which already
 * applies the SuperAdmin-selection asymmetry; this function does not re-derive it.
 */
export function capabilitiesFor(claims: ViewerClaims, scope: CompanyScope): ViewerCapabilities {
  const { role } = claims
  // See "The 'admin with a company' shape" in the module header.
  const adminWithCompany = isAdminRole(role) && scope.status === 'ready'
  const runsADepartment = role === LEADER || role === SUPERVISOR

  const trackingClaims =
    claims.personaExternalId === ''
      ? null
      : { personaExternalId: claims.personaExternalId, role: role ?? '', nodoExternalId: claims.nodoExternalId }

  return {
    seesWholeCompany: adminWithCompany,
    seesTeam: runsADepartment,
    seesOnlySelf: !isAdminRole(role) && !runsADepartment,
    canAuthorSurveys: adminWithCompany,
    canLaunchMicroclimate: adminWithCompany,
    canCreateActionPlan: adminWithCompany,
    canShareReports: adminWithCompany,
    canExport: adminWithCompany || runsADepartment,
    canManageOrg: adminWithCompany,
    canUseDirectoryPickers: adminWithCompany,
    canRecordProgress: (plan) => canManagePlan(plan, trackingClaims),
    canOpenResults: (survey) =>
      role === SUPER_ADMIN || (role === COMPANY_ADMIN && claims.companyId !== undefined && claims.companyId === survey.companyId),
  }
}

/**
 * The stored token's claims, through the two readers the app already has:
 * `readSessionClaims` for `role`/`companyId` (with its `''` normalisation) and
 * `readTrackingClaims` for `sub`/`nodoId`. Never from an env var, never from a prop.
 */
export function readViewerClaims(): ViewerClaims {
  const { role, companyId } = readSessionClaims()
  const tracking = readTrackingClaims()
  return {
    role,
    companyId,
    personaExternalId: tracking?.personaExternalId ?? '',
    nodoExternalId: tracking?.nodoExternalId ?? '',
  }
}

/**
 * **The hook every redesigned screen reads.** Must be used inside
 * `CompanyContextProvider` (mounted by `AdminLayout`), because the company scope is
 * half of the answer for every admin capability.
 *
 * Memoised on the scope object, which the provider already memoises: the token is read
 * once per scope change rather than on every render, matching how the provider itself
 * reads it.
 */
export function useViewerCapabilities(): ViewerCapabilities {
  const scope = useCompanyScope()
  return useMemo(() => capabilitiesFor(readViewerClaims(), scope), [scope])
}
