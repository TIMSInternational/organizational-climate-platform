import type {
  DashboardPendingSurvey,
  EmployeeDashboard,
  EmployeeLastOutcome,
} from '../../api/dashboard'
import { estimatedMinutes } from '../../../surveys/respondEstimate'
import type { EmployeeHomeModel, HomeOutcome, HomeSurvey } from './model'

const DAY_MS = 86_400_000

/**
 * Whole days from `asOf` to a close date, floored at zero — or `null` when either date
 * is unusable.
 *
 * A deadline already past is not "-3 days left"; it is nothing left, and "Cierra hoy"
 * says so. `Math.ceil` rather than `floor`: a survey closing in eight hours has a day left
 * to the reader, not none. The same rule `EmployeeDashboardView.daysUntil` kept, measured
 * against the model's own clock rather than `Date.now()` so a test can pin it.
 */
export function daysUntil(closesAt: string, asOf: string): number | null {
  const at = Date.parse(closesAt)
  const now = Date.parse(asOf)
  if (Number.isNaN(at) || Number.isNaN(now)) return null
  return Math.max(0, Math.ceil((at - now) / DAY_MS))
}

function toSurvey(survey: DashboardPendingSurvey, asOf: string): HomeSurvey {
  return {
    id: survey.id,
    name: survey.title,
    questionCount: survey.questionCount,
    minutes: estimatedMinutes(survey.questionCount),
    closesAt: survey.endDate,
    daysLeft: daysUntil(survey.endDate, asOf),
    // A literal `true`, never a truthiness test: a field gone missing — an older server,
    // a cached body — must read as no claim at all.
    anonymous: survey.anonymous === true,
  }
}

/**
 * The last-outcome payload as the page reads it, or `null` — the endpoint's own answer
 * for "this company has never closed a survey", which the page draws as no card at all.
 */
export function composeOutcome(outcome: EmployeeLastOutcome | null): HomeOutcome | null {
  if (outcome === null) return null
  // Named departments only, de-duplicated: two plans in one department must not read as
  // "Ingeniería e Ingeniería", and a nameless plan contributes nothing.
  const planDepartments = [
    ...new Set(
      outcome.plansOpenedSince
        .map((plan) => plan.departmentName)
        .filter((name): name is string => name !== null),
    ),
  ]
  return {
    surveyName: outcome.surveyTitle,
    closedOn: outcome.closedOn,
    responseCount: outcome.responseCount,
    departmentCount: outcome.departmentCount,
    protectedDepartmentCount: outcome.protectedDepartmentCount,
    floor: outcome.minimumGroupSize,
    planDepartments,
    // The list is oldest-first, and the row is read as "when did the company start
    // acting", against the closing date the row above it has just given.
    firstPlanOpenedOn: outcome.plansOpenedSince[0]?.createdAt ?? null,
    openPlanCount: outcome.openPlanCount,
  }
}

/**
 * The whole Home, from what the three reads returned.
 *
 * Pure, so every derived figure — the countdown, the minutes, the list-versus-count
 * comparison, the de-duplicated departments — is tested without a DOM, and the view
 * below it only draws.
 */
export function composeEmployeeHome(input: {
  dashboard: EmployeeDashboard
  lastOutcome: EmployeeLastOutcome | null
  /** The lead survey's `allowPartialResponses`, or `null` when it could not be read. */
  leadAllowsSaveForLater: boolean | null
  asOf: string
}): EmployeeHomeModel {
  const { dashboard, asOf } = input
  const surveys = dashboard.pendingSurveys.map((survey) => toSurvey(survey, asOf))
  const [lead = null, ...others] = surveys

  return {
    asOf,
    personName: dashboard.name,
    departmentName: dashboard.departmentName,
    pendingCount: dashboard.pendingSurveyCount,
    lead,
    others,
    // The count is the truth and the list is a page of it (`SurveyRowLimit` = 5).
    beyondList: dashboard.pendingSurveyCount > surveys.length,
    leadAllowsSaveForLater: lead === null ? null : input.leadAllowsSaveForLater,
    outcome: composeOutcome(input.lastOutcome),
  }
}
