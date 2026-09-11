import type {
  DashboardPendingSurvey,
  EmployeeDashboard,
  EmployeeLastOutcome,
} from '../../api/dashboard'
import { estimatedMinutes } from '../../../surveys/respondEstimate'
import type { EmployeeHomeModel, HomeOutcome, HomeSurvey } from './model'

const DAY_MS = 86_400_000

/**
 * Whole calendar days from the reader's today to the day a survey closes, floored at
 * zero — or `null` when either date is unusable.
 *
 * Calendar days, not elapsed time, because the sentence prints a calendar day beside the
 * count: "Cierra en 30 días · el 10 de octubre". The close is a calendar day stamped in
 * UTC and printed in UTC (`lib/calendarDay.ts`, `formatDayMonth`); today is the reader's
 * own date. Counted in milliseconds instead, Q4's close (02:03 UTC on 10 Oct) read from
 * Costa Rica at 21:50 on 10 Sep is 28.9 days away and ceils to 29 — one fewer than the
 * days between the two dates the same line prints, where the canvas says "30 días".
 *
 * A deadline already past is not "-3 days left"; it is nothing left, and "Cierra hoy" says
 * so. Measured against the model's own clock rather than `Date.now()` so a test can pin it.
 */
export function daysUntil(closesAt: string, asOf: string): number | null {
  const at = Date.parse(closesAt)
  const now = Date.parse(asOf)
  if (Number.isNaN(at) || Number.isNaN(now)) return null
  const close = new Date(at)
  const today = new Date(now)
  const closeDay = Date.UTC(close.getUTCFullYear(), close.getUTCMonth(), close.getUTCDate())
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  // `round`, not `floor`: both ends are UTC midnights, so the difference is a whole number
  // of days and rounding only absorbs floating error.
  return Math.max(0, Math.round((closeDay - todayDay) / DAY_MS))
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
