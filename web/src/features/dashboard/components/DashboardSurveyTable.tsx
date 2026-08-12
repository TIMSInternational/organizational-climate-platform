import { Link } from 'react-router'
import { useTranslation } from '../../../i18n'
import { EmptyState, Table } from '../../../components/ui'
import { statusLabel } from '../../surveys/surveyVocabulary'
import { calendarDay } from '../calendarDay'

/**
 * The columns the company and department dashboards genuinely share.
 *
 * Structural, not one of the payload interfaces, because the two payloads are no longer the
 * same shape — see `targetAudienceCount` below. `DashboardSurveySummary` and
 * `DashboardDepartmentSurveySummary` both satisfy this.
 */
export interface DashboardSurveyTableRow {
  id: string
  title: string | null
  status: string
  endDate: string
  /**
   * Completed responses, **already scoped by the server to whatever this page is about** —
   * the whole tenant on the company dashboard, this department alone on the department one.
   */
  responseCount: number
  /**
   * The tenant's invited headcount. Absent on a department's payload: it is a single
   * author-entered number for the whole company with no per-department breakdown, so there
   * is nothing honest to put in that column on a department's page.
   */
  targetAudienceCount?: number | null
}

interface DashboardSurveyTableProps {
  surveys: readonly DashboardSurveyTableRow[]
  /**
   * Whether to link each row to the survey's admin detail page.
   *
   * **Off by default, and the default is the load-bearing part.** `GET /surveys/{id}` is
   * gated on `SurveyEndpoints.CanAdminister` — SuperAdmin, or a CompanyAdmin on their own
   * tenant — so a leader or supervisor following that link lands on a 403. This table is
   * shared by the company dashboard (whose viewer can administer) and the department
   * dashboard (whose viewer cannot), so linking unconditionally would put a guaranteed
   * dead end on one of the two pages that use it.
   */
  canOpenSurvey?: boolean
  /**
   * Whether to draw the "Target" column.
   *
   * **Off for the department dashboard, and that is a correctness fix rather than a
   * preference.** The only invited headcount the server has is `Survey.TargetAudienceCount`,
   * a tenant-wide number; printing it on a department's page put "Target 200" beside a
   * six-person team's own figures. There is no per-department equivalent to put there
   * instead, so the column goes away rather than being filled with something invented.
   */
  showTarget?: boolean
}

/**
 * The ongoing-surveys table, shared by the company and department dashboards.
 *
 * Shared because the two views draw the same *columns* — the row is a survey either way, and
 * status, deadline and participation are wanted on both. They are emphatically **not** the
 * same projection: `responseCount` arrives scoped to the tenant on one page and to one
 * department on the other, and the department payload has no target at all. The scoping is
 * the server's, decided per endpoint; this component draws whatever it is handed and must
 * not be given a row from the wrong scope.
 *
 * Deliberately NOT shared with the employee dashboard: that one renders
 * `DashboardPendingSurvey`, which carries no response count, because telling a respondent
 * how many colleagues have already answered is the figure that turns an anonymous survey
 * into a headcount.
 */
export default function DashboardSurveyTable({
  surveys,
  canOpenSurvey = false,
  showTarget = true,
}: DashboardSurveyTableProps) {
  const { t, locale } = useTranslation()

  if (surveys.length === 0) {
    return (
      <EmptyState
        title={t('dashboard.noOngoingSurveys')}
        description={t('dashboard.startGatheringInsights')}
      />
    )
  }

  return (
    <Table>
      {/* The redesign's column label: `text-2xs`, uppercase, letterspaced — the same
          micro-label the Departments and Company Settings tables use, so two tables one
          click apart do not label themselves differently.

          `text-fg-secondary`, not `text-fg-tertiary`. The other tables reach for tertiary
          here, but `--admin-font-tertiary` is #818181 in BOTH palettes and measures 3.90:1
          on the panel and 3.42:1 on the recessed surface — under the 4.5:1 that `text-2xs`
          needs, which is the exact pairing the survey-results lane had to fix in
          `ClimateMap`. Secondary clears it on both surfaces in both themes. */}
      <thead className="text-2xs uppercase tracking-label text-fg-secondary">
        <tr>
          <th>{t('surveys.surveyName')}</th>
          <th>{t('common.status')}</th>
          <th>{t('dashboard.responses')}</th>
          {showTarget && <th>{t('dashboard.target')}</th>}
          <th>{t('surveys.closesOn')}</th>
        </tr>
      </thead>
      <tbody>
        {surveys.map((survey) => (
          <tr key={survey.id}>
            <td>
              {canOpenSurvey ? (
                <Link to={`/surveys/${survey.id}`}>{survey.title ?? t('surveys.untitled')}</Link>
              ) : (
                survey.title ?? t('surveys.untitled')
              )}
            </td>
            <td>{statusLabel(t, survey.status)}</td>
            {/* Every reading is mono with tabular figures — the rule the whole redesign
                rests on, and the one this table was missing while the KPI tiles directly
                above it honoured it. Two faces for the same kind of number on one screen is
                exactly what stops it reading as an instrument. */}
            <td className="font-mono tabular-nums">{survey.responseCount}</td>
            {/* An em dash, not "0": a survey with no invitation total has no target, and
                printing zero would read as "nobody was invited". */}
            {showTarget && (
              <td className="font-mono tabular-nums">{survey.targetAudienceCount ?? '—'}</td>
            )}
            {/* UTC, not the browser's zone: these are calendar days, and a reader
                west of UTC was shown the day before. See `calendarDay`. */}
            <td className="whitespace-nowrap font-mono tabular-nums">
              {calendarDay(Date.parse(survey.endDate), locale)}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
