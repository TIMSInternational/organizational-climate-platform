import type { SurveyAudienceSelection } from '../../features/surveys/api/surveyDistribution'
import type { User } from '../../features/org-structure/api/users'

/**
 * The audience arithmetic, in a `.ts` module rather than beside the component.
 *
 * Two reasons. It is the part worth testing on its own — the count it produces is the
 * only safeguard between an admin and mailing the wrong people, and an off-by-one in it
 * is not undoable. And `oxlint`'s `only-export-components` rule reserves a `.tsx` file for
 * components, so a helper exported from one costs a lint warning the project has no
 * headroom for.
 */
export type AudienceMode = 'allTargeted' | 'departments' | 'users'

/**
 * The user ids a selection resolves to, mirroring `ResolveAudienceAsync` in
 * `SurveyDistributionEndpoints.cs` clause for clause:
 *
 * - inactive users are never in the audience;
 * - department membership is `users.department_id`, and a user with none is in no
 *   department rather than in all of them;
 * - `allTargeted` means the survey's own `survey_department_targets` — **or the whole
 *   company when it targets none**, which is the same rule `SurveyQueries.AssignedTo`
 *   applies to `/surveys/my`. Reading that empty list as "nobody" instead of "everybody"
 *   is the one mistake here that is both easy and unrecoverable.
 *
 * The users passed in are already scoped to the survey's company by the caller, so no
 * cross-tenant filtering happens (or could usefully happen) here.
 */
export function estimateAudience(
  mode: AudienceMode,
  users: readonly User[],
  selectedDepartmentIds: readonly string[],
  selectedUserIds: readonly string[],
  surveyDepartmentIds: readonly string[],
): string[] {
  const active = users.filter((user) => user.isActive)

  if (mode === 'users') {
    const chosen = new Set(selectedUserIds)
    return active.filter((user) => chosen.has(user.id)).map((user) => user.id)
  }

  const departmentIds = mode === 'departments' ? selectedDepartmentIds : surveyDepartmentIds

  if (mode === 'allTargeted' && departmentIds.length === 0) {
    return active.map((user) => user.id)
  }

  const wanted = new Set(departmentIds)
  return active
    .filter((user) => user.departmentId !== null && wanted.has(user.departmentId))
    .map((user) => user.id)
}

/**
 * The request body for a mode plus its selections, or `null` when the mode needs a
 * selection and has none.
 *
 * `null` is what keeps the dispatch button disabled. The server refuses a request with no
 * selector rather than reading it as "everybody" — this is the client half of the same
 * rule, so the admin gets a disabled button instead of a 400.
 */
export function audienceSelection(
  mode: AudienceMode,
  selectedDepartmentIds: readonly string[],
  selectedUserIds: readonly string[],
): SurveyAudienceSelection | null {
  if (mode === 'allTargeted') return { allTargeted: true }
  if (mode === 'departments') {
    return selectedDepartmentIds.length > 0 ? { departmentIds: [...selectedDepartmentIds] } : null
  }
  return selectedUserIds.length > 0 ? { userIds: [...selectedUserIds] } : null
}
