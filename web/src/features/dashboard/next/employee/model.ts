/**
 * The typed model behind the redesigned employee Home — `/dashboard` for the `employee`
 * role, and for any role the dispatch does not recognise (`DashboardPage.tsx`).
 *
 * Every number the page prints is derived here, in `compose.ts`, from the two payloads
 * the old view already read — `GET /dashboard/employee` and
 * `GET /dashboard/employee/last-outcome` — plus one flag from the lead survey's own
 * `GET /surveys/{id}/respond`. Nothing on this page is sample data: every field has an
 * endpoint, so there is no `sampleModel` and no "Datos de muestra" chip.
 *
 * Naming: the human-readable fields are `name`, not `title`/`label`, because the model
 * carries payload content (a survey's own title, a department's name) rather than UI
 * copy, and `noHardcodedStrings.test.ts` reads a `title:` or `label:` property as copy.
 */

/** A survey the reader still owes an answer to. */
export interface HomeSurvey {
  id: string
  /** The survey's own title, already resolved for the locale; `null` when it has none. */
  name: string | null
  questionCount: number
  /** `estimatedMinutes(questionCount)` — computed, never typed. */
  minutes: number
  /** ISO timestamp the survey stops accepting answers. */
  closesAt: string
  /**
   * Whole days from `asOf` to `closesAt`, floored at zero; `null` for an unparseable
   * date, which draws no countdown at all rather than a guessed one.
   */
  daysLeft: number | null
  /**
   * The survey's `Settings.Anonymous`. **Only `true` may be drawn as a promise** — see
   * `DashboardPendingSurvey.anonymous`: silence is the only safe reading of anything else.
   */
  anonymous: boolean
}

/** "What came of the last one", or `null` when the company has never closed a survey. */
export interface HomeOutcome {
  surveyName: string | null
  /** ISO timestamp the survey closed. */
  closedOn: string
  /** Completed responses company-wide. A tenant-wide count identifies nobody. */
  responseCount: number
  /** Departments that answered at all, protected ones included. */
  departmentCount: number
  /** How many of them were withheld for being under the floor. Never their names. */
  protectedDepartmentCount: number
  /** The floor the server applied, sent with the payload rather than assumed to be 5. */
  floor: number
  /**
   * The named departments of the plans opened since, de-duplicated, in the order the
   * server listed them. A plan whose department is `null` contributes no name: `null`
   * is the suppression doing its job (`DashboardPlanOpened`), not a gap to fill.
   */
  planDepartments: readonly string[]
  /** When the first of those plans was opened; `null` when none has been. */
  firstPlanOpenedOn: string | null
  /** The full tally of still-open plans opened since, which may exceed the listed page. */
  openPlanCount: number
}

export interface EmployeeHomeModel {
  /** ISO timestamp the model was composed at; day counts are measured against it. */
  asOf: string
  personName: string
  departmentName: string | null
  /** The true total of outstanding surveys — the list below is a page of it (5). */
  pendingCount: number
  /** The survey the page leads with: the first the server listed, or `null`. */
  lead: HomeSurvey | null
  /** Every other listed survey, as the quieter "También abierta" rows. */
  others: readonly HomeSurvey[]
  /** The count says more is outstanding than the page lists. */
  beyondList: boolean
  /**
   * Whether the lead survey lets the respondent save and finish later — its own
   * `Settings.AllowPartialResponses`, read from `GET /surveys/{id}/respond`. `null` when
   * that read has not answered (or failed): the page then says nothing about saving,
   * because "you can finish later" is a promise about a setting it could not see.
   */
  leadAllowsSaveForLater: boolean | null
  outcome: HomeOutcome | null
}
