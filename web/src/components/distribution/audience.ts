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
 * Who a survey is aimed at, as the survey itself stores it: `survey_department_targets`
 * and `survey_user_targets`, which are a UNION and not alternatives.
 *
 * A record rather than two positional lists because that is the mistake this module
 * already made once — `estimateAudience` was handed the survey's departments and an empty
 * array for everything else, and four arrays of strings in a row is a signature that
 * invites exactly that.
 */
export interface SurveyTargets {
  /** `survey.departmentIds`. */
  departmentIds: readonly string[]
  /** `survey.userIds`. People aimed at individually (#587). */
  userIds: readonly string[]
}

/** What the administrator has ticked in the audience selector. */
export interface AudienceSelectionInput {
  departmentIds: readonly string[]
  userIds: readonly string[]
}

/**
 * Whether a survey reaches the whole company — true only when it targets NEITHER
 * departments nor people.
 *
 * The label's half of the rule, exported so the three screens that print "Toda la
 * empresa" cannot each decide it for themselves. Branching on `departmentIds.length === 0`
 * alone is how a survey aimed at 240 people by name came to announce itself as
 * company-wide.
 */
export function targetsWholeCompany(targets: SurveyTargets): boolean {
  return targets.departmentIds.length === 0 && targets.userIds.length === 0
}

/**
 * The user ids a selection resolves to, mirroring `SurveyQueries.Audience` (the query
 * `ResolveAudienceAsync`, the respond gate and `/surveys/my` all share) clause for clause:
 *
 * - inactive users are never in the audience;
 * - department membership is `users.department_id`, and a user with none is in no
 *   department rather than in all of them;
 * - `allTargeted` means the survey's own audience: the UNION of the departments it targets
 *   and the people it targets, **or the whole company when it targets neither**. Reading an
 *   empty list as "nobody" instead of "everybody" is the one mistake here that is both easy
 *   and unrecoverable — and reading *one* empty list as "no targets at all" was the actual
 *   defect: a survey aimed at a single person reported the entire company.
 *
 * The users passed in are already scoped to the survey's company by the caller, so no
 * cross-tenant filtering happens (or could usefully happen) here.
 *
 * One pass over the directory with an OR predicate, like the server's single `WHERE`: it
 * dedupes a person who is both in a targeted department and targeted by name, and it keeps
 * the directory's own order instead of inventing one from the order the clauses ran in.
 */
export function estimateAudience(
  mode: AudienceMode,
  users: readonly User[],
  selection: AudienceSelectionInput,
  surveyTargets: SurveyTargets,
): string[] {
  const active = users.filter((user) => user.isActive)

  if (mode === 'users') {
    const chosen = new Set(selection.userIds)
    return active.filter((user) => chosen.has(user.id)).map((user) => user.id)
  }

  if (mode === 'departments') {
    const wanted = new Set(selection.departmentIds)
    return active
      .filter((user) => user.departmentId !== null && wanted.has(user.departmentId))
      .map((user) => user.id)
  }

  if (targetsWholeCompany(surveyTargets)) {
    return active.map((user) => user.id)
  }

  const wantedDepartments = new Set(surveyTargets.departmentIds)
  const wantedUsers = new Set(surveyTargets.userIds)
  return active
    .filter(
      (user) =>
        (user.departmentId !== null && wantedDepartments.has(user.departmentId)) ||
        wantedUsers.has(user.id),
    )
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
