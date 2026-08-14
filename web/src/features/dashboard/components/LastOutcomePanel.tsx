import { useCallback, type ReactNode } from 'react'
import { CheckCircle2, Clock, Target } from 'lucide-react'
import { getEmployeeLastOutcome } from '../api/dashboard'
import { useDashboardData } from '../useDashboardData'
import { calendarDay } from '../../../lib/calendarDay'
import { MonoReadings, SectionHeading } from './dashboardGrammar'
import { useTranslation } from '../../../i18n'

/**
 * "What came of the last one" — the panel an employee's Home carries between surveys.
 *
 * ## Why this panel exists at all
 *
 * `SurveyResponseEndpoints.cs:102` collapses "unknown" into "deliberately not recorded":
 * on an anonymous survey the response row's `user_id` is NULL, so the product **cannot**
 * tell this reader what they themselves did. Every completion count, streak and "you
 * answered 4 of 5" is a promise it has already decided not to be able to keep — which is
 * why the four KPI tiles came off Home rather than being fixed.
 *
 * If we cannot say what *they* did, we can still say what *came of it*: results published,
 * plans opened, and how many are still open. Those are company-level facts, knowable
 * without knowing who answered, and they are the only honest reason this product has to
 * bring someone back to this page between surveys.
 *
 * ## It loads on its own, and it never takes Home down
 *
 * A second request, made in parallel with `/dashboard/employee` rather than after it. The
 * failure mode is total silence: a refused, malformed or absent answer draws **nothing**,
 * so a panel that is at best supplementary can never be the reason a person cannot see the
 * survey they owe. `null` at 200 is the endpoint's normal answer for "this company has
 * never closed a survey", and its own remark spells out the contract this component keeps:
 * *the panel is absent, not empty*. A zero-filled render would say "0 answers across 0
 * departments" about a survey that never happened.
 *
 * ## The protected clause names nobody, and that is load-bearing
 *
 * Suppression exists because a group below the floor *is* the handful of people in it, so
 * announcing "Finance was withheld" would defeat it in the act of reassuring anyone. The
 * server therefore sends a count and no names, and this component has no branch that could
 * reintroduce one: `employee.cameOfItProtectedOne` / `...Many` take the floor and a count,
 * and there is no catalogue key that takes a department. `i18n/employeeCopy.test.ts` holds
 * that shape from the other end by failing if either string grows a `{department}`.
 *
 * The same rule reaches the plan rows. A plan's `departmentName` is null both when the plan
 * is company-wide and when its department was protected — indistinguishable on purpose —
 * so nameless plans simply contribute no name to the list, and the row still renders. See
 * `DashboardPlanOpened`.
 *
 * ## Row three, and where it departs from the drawing
 *
 * The approved design's third row is "one thing has not moved yet — Recognition scored
 * lowest company-wide and has no plan against it". That needs a per-dimension aggregation
 * cross-referenced against action plans, which does not exist; inventing it here would also
 * be a *score* on the one payload built to contain none. The row says how many of the plans
 * are still open instead.
 *
 * Worth knowing while reading it: `DashboardQueries.OpenPlansOpenedSince` filters to
 * outstanding plans *before* both the page and the tally are taken, so rows two and three
 * describe one population and print one number twice. That is honest — nothing opened since
 * has been finished — but it is the reason this reads as a restatement rather than as a
 * subset, and the row is dropped entirely at zero rather than printing "0 of them are still
 * open" under "No action plans have been opened since."
 */
export default function LastOutcomePanel() {
  const { t, locale } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  const load = useCallback(() => getEmployeeLastOutcome(baseUrl, locale), [baseUrl, locale])
  const { data, loading, failed } = useDashboardData(load)

  // Silence covers all three of "not yet", "refused" and "nothing has closed". No skeleton
  // either: a placeholder for a panel that may correctly never appear is a promise of
  // content, and this one is under no obligation to have any.
  if (loading || failed || data === null) return null

  const survey = data.surveyTitle ?? t('surveys.untitled')

  // Named departments only, de-duplicated. Two plans in one department must not read as
  // "In Engineering and Engineering", and a nameless plan contributes nothing — see the
  // docstring: null is the suppression doing its job, not a gap to fill.
  const named = [
    ...new Set(
      data.plansOpenedSince
        .map((plan) => plan.departmentName)
        .filter((name): name is string => name !== null),
    ),
  ]
  // `Intl.ListFormat` rather than `join(', ')`: the conjunction and the serial comma are
  // the reader's language's business, and Spanish writes "A, B y C" where English writes
  // "A, B, and C".
  const departments =
    named.length > 0
      ? new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(named)
      : null

  // A reading, so it is set in mono like every other number on this screen — which a bare
  // `t()` could not do, `t` returning one flat string with the count already inside it.
  const plansTitle =
    data.openPlanCount === 0 ? (
      t('employee.cameOfItPlansNone')
    ) : data.openPlanCount === 1 ? (
      t('employee.cameOfItPlansTitleOne')
    ) : (
      <MonoReadings
        t={t}
        locale={locale}
        messageKey="employee.cameOfItPlansTitle"
        params={{ count: data.openPlanCount }}
      />
    )

  return (
    <section>
      <SectionHeading>{t('employee.cameOfItHeading')}</SectionHeading>
      {/* The prototype's `.came`: hairline-separated rows sharing one rounded box. The
          1px gaps ARE the border colour showing through, so there is no per-row rule to
          keep in sync with the container's own. */}
      <div className="grid gap-px overflow-hidden rounded-lg border border-line-light bg-line-light">
        <OutcomeRow
          icon={<CheckCircle2 aria-hidden="true" className="size-3" />}
          tone="bg-accent-green-soft text-accent-green"
          title={t('employee.cameOfItClosedTitle', { survey })}
          aside={<time dateTime={data.closedOn}>{calendarDay(Date.parse(data.closedOn), locale)}</time>}
        >
          <MonoReadings
            t={t}
            locale={locale}
            messageKey="employee.cameOfItClosedBody"
            params={{ responses: data.responseCount, departments: data.departmentCount }}
          />
          {/* Appended to the same paragraph rather than given a line of its own: it is a
              qualification of the sentence above it, and a protected department that
              looked like its own item would be a place a reader goes looking for a name. */}
          {data.protectedDepartmentCount > 0 && (
            <>
              {' '}
              <MonoReadings
                t={t}
                locale={locale}
                messageKey={
                  data.protectedDepartmentCount === 1
                    ? 'employee.cameOfItProtectedOne'
                    : 'employee.cameOfItProtectedMany'
                }
                params={{
                  count: data.protectedDepartmentCount,
                  floor: data.minimumGroupSize,
                }}
              />
            </>
          )}
        </OutcomeRow>

        <OutcomeRow
          icon={<Target aria-hidden="true" className="size-3" />}
          tone="bg-accent-blue-soft text-accent-blue"
          title={plansTitle}
          aside={
            data.plansOpenedSince.length > 0 ? (
              // The first plan opened, because the list is oldest-first and this row is
              // read as "when did the company start acting", against a closing date the
              // row above has just given.
              <time dateTime={data.plansOpenedSince[0].createdAt}>
                {calendarDay(Date.parse(data.plansOpenedSince[0].createdAt), locale)}
              </time>
            ) : null
          }
        >
          {departments && t('employee.cameOfItPlansBody', { departments })}
        </OutcomeRow>

        {/* Dropped rather than drawn as a zero. "0 of them are still open" beneath "No
            action plans have been opened since" is a count of a set the reader was just
            told is empty. */}
        {data.openPlanCount > 0 && (
          <OutcomeRow
            icon={<Clock aria-hidden="true" className="size-3" />}
            tone="bg-accent-amber-soft text-accent-amber-ink"
            title={
              <MonoReadings
                t={t}
                locale={locale}
                messageKey="employee.cameOfItOpenTitle"
                params={{ count: data.openPlanCount }}
              />
            }
            // A word, not a date, so it is not marked up as one.
            aside={<span>{t('employee.cameOfItOpenMarker')}</span>}
          >
            {t('employee.cameOfItOpenBody')}
          </OutcomeRow>
        )}
      </div>
    </section>
  )
}

/**
 * One row: a tinted glyph, the claim and its qualification, and a date on the right.
 *
 * `tone` is a class pair rather than a token name because the three tones here are one-offs
 * on one panel — `Chip`'s closed set of five is the vocabulary for *states*, and these are
 * not states. The glyph is `aria-hidden` at every call site: it repeats the row's own
 * words, and the row is prose rather than a control.
 *
 * `children` is optional. The plans row has no qualifying line when every plan it lists is
 * nameless, and an empty `<p>` would leave a gap that reads as content that failed to load.
 */
function OutcomeRow({
  icon,
  tone,
  title,
  aside,
  children,
}: {
  icon: ReactNode
  tone: string
  title: ReactNode
  aside: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-start gap-inline bg-surface-panel px-card py-3">
      <span aria-hidden="true" className={`grid size-5 place-items-center rounded-md ${tone}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="m-0 font-medium">{title}</p>
        {/* `text-fg-secondary`, not tertiary: measured at 3.90:1 on the panel in light,
            the tertiary ink fails WCAG AA 1.4.3 for body text and this is 11px. */}
        {children && <p className="m-0 max-w-measure text-xs text-fg-secondary">{children}</p>}
      </div>
      <span className="whitespace-nowrap text-xs text-fg-secondary">{aside}</span>
    </div>
  )
}
