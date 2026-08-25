import { useTranslation } from '../../../i18n'
import { Alert, AlertDescription, AlertTitle, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui'
import KpiTile from '../../../components/charts/KpiTile'
import { formatMetric } from '../../../components/charts/formatMetric'
import ResultsSuppressionNotice from '../../surveys/components/ResultsSuppressionNotice'
import type {
  ReportAIInsight,
  ReportDocument,
  ReportSurveySection,
} from '../reportDocument'

/**
 * The body of a shared report: one section per survey, then the insights.
 *
 * ## Why the renderer is separate from the page
 *
 * `SharedReportPage` owns the things that make the route *public* — resolving the token
 * exactly once, the single "not available" outcome, the `noindex` tag. This owns the
 * document. Keeping them apart means the security-shaped decisions live in one small
 * file that can be read end to end, instead of below four hundred lines of tables.
 *
 * ## Everything here is a projection. Nothing is recomputed
 *
 * Not one number on this screen is derived from another. Participation comes from
 * `participation`, dimension averages from `dimensions`, department rates from
 * `departments` — each printed as the aggregation produced it. That is not fussiness:
 * the aggregation is where the anonymity floor is applied, so any arithmetic done here
 * would be arithmetic outside the floor. The clearest case is a withheld department,
 * whose `respondentCount` the server has already zeroed; a renderer that computed "rate
 * x headcount" would reconstruct exactly the figure that was withheld.
 *
 * ## Suppression is rendered, never elided
 *
 * A suppressed survey section shows its participation counters and
 * `ResultsSuppressionNotice` in place of its scores — the same component the
 * authenticated results page uses, so the two surfaces cannot drift into two different
 * explanations of one rule. A withheld department keeps its row and reads "Withheld"
 * rather than disappearing from the table, because a row that vanishes invites the
 * reader to work out which department is missing from a list they can see elsewhere.
 */
export default function SharedReportSections({ document }: { document: ReportDocument }) {
  const { t } = useTranslation()

  return (
    <>
      {document.surveys.length === 0 ? (
        <p className="max-w-prose text-base text-fg-secondary">{t('sharedReport.noSurveys')}</p>
      ) : (
        document.surveys.map((section) => (
          <SurveySection key={section.surveyId} section={section} />
        ))
      )}

      {document.aiInsights.length > 0 && (
        <section className="grid gap-panel-gap" aria-labelledby="shared-report-insights">
          <h2 id="shared-report-insights" className="text-lg font-semibold text-fg-primary">
            {t('sharedReport.insightsHeading')}
          </h2>
          {document.aiInsights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </section>
      )}
    </>
  )
}

function SurveySection({ section }: { section: ReportSurveySection }) {
  const { t, locale } = useTranslation()
  const { participation } = section
  const headingId = `shared-report-survey-${section.surveyId}`

  return (
    <section className="grid gap-panel-gap" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold text-fg-primary">
        {section.title ?? t('surveyResults.untitled')}
      </h2>

      {/* Shown for a suppressed section too. "Participation figures are still shown: a
          count of responses identifies nobody" is the server's own rule, stated in
          `ReportSurveySection` and repeated by the suppression notice below. */}
      <div className="grid grid-cols-1 gap-panel-gap sm:grid-cols-2 xl:grid-cols-4">
        {participation.invitedCount !== null && (
          <KpiTile
            label={t('surveyResults.kpiInvited')}
            value={participation.invitedCount}
            locale={locale}
          />
        )}
        <KpiTile
          label={t('surveyResults.kpiResponses')}
          value={participation.responseCount}
          locale={locale}
        />
        <KpiTile
          label={t('surveyResults.kpiCompleted')}
          value={participation.completedCount}
          locale={locale}
        />
        {participation.participationRate !== null && (
          <KpiTile
            label={t('surveyResults.kpiParticipationRate')}
            value={participation.participationRate}
            format={{ kind: 'percentage' }}
            locale={locale}
          />
        )}
      </div>

      {section.isSuppressed ? (
        <ResultsSuppressionNotice
          reason={section.suppressionReason}
          minimumGroupSize={section.minimumGroupSize}
        />
      ) : (
        section.dimensions.length > 0 && (
          <Table>
            <TableCaption>{t('sharedReport.dimensionsCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('sharedReport.dimension')}</TableHead>
                <TableHead>{t('sharedReport.questionCount')}</TableHead>
                {/* Not `surveyResults.answersUnit`. That key is the *unit* inside a
                    sentence — "170 respuestas" — so it is spelled lowercase, and reusing
                    it here put a lowercase word in a row of capitalised column headings.
                    Caught in the PNG; no assertion in this file's tests could have seen
                    it, because the string was present and correct for its own purpose. */}
                <TableHead>{t('sharedReport.answeredCount')}</TableHead>
                <TableHead>{t('sharedReport.averageScore')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.dimensions.map((dimension) => (
                <TableRow key={dimension.dimension}>
                  {/* The author's own category text, printed as authored. See
                      `dimensionLabel` for why an uncatalogued category is not
                      replaced with boilerplate — and note this surface, like the
                      analyst's results page, prints the key verbatim. */}
                  <TableCell>{dimension.dimension}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {dimension.questionCount.toLocaleString(locale)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {dimension.answeredCount.toLocaleString(locale)}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {dimension.averageScore === null
                      ? t('surveyResults.notApplicable')
                      : dimension.averageScore.toLocaleString(locale, {
                          maximumFractionDigits: 2,
                        })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      )}

      {section.departments.length > 0 && (
        <Table>
          <TableCaption>{t('sharedReport.departmentsCaption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('surveyResults.dimensionDepartment')}</TableHead>
              <TableHead>{t('surveyResults.respondents')}</TableHead>
              <TableHead>{t('surveyResults.participationRate')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.departments.map((department) => (
              <TableRow key={department.departmentId}>
                <TableCell>{department.name ?? t('surveyResults.unsegmented')}</TableCell>
                {department.isSuppressed ? (
                  // One cell spanning both numeric columns, so there is no empty box a
                  // reader could read as a zero. `withheld` is the same word the
                  // authenticated breakdown table uses for the same state.
                  <TableCell colSpan={2}>{t('surveyResults.withheld')}</TableCell>
                ) : (
                  <>
                    <TableCell className="font-mono tabular-nums">
                      {department.respondentCount.toLocaleString(locale)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {department.participationRate === null
                        ? t('surveyResults.notApplicable')
                        : formatMetric(
                            department.participationRate,
                            { kind: 'percentage' },
                            locale,
                          )}
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {section.suppressedDepartmentCount > 0 && (
        <p className="max-w-prose text-sm text-fg-secondary">
          {t('sharedReport.departmentsWithheld', {
            count: section.suppressedDepartmentCount,
            minimum: section.minimumGroupSize,
          })}
        </p>
      )}
    </section>
  )
}

/**
 * One AI insight, as a link holder reads it.
 *
 * `affectedSegments` is deliberately **not** rendered, and it is the one omission on
 * this page that is a judgement rather than a projection. It is a free list of segment
 * names written by the insight generator, and it passes through none of the aggregation
 * that applies the anonymity floor — so a small department can be named there while the
 * table above withholds its row. Naming it beside a withheld row on the most exposed
 * page in the product is the wrong side of that argument to be on. The authenticated
 * Insights page shows it (`insights.affectedSegments`) and should: its reader is inside
 * the tenant.
 */
function InsightCard({ insight }: { insight: ReportAIInsight }) {
  const { t, locale } = useTranslation()

  return (
    <Alert>
      <AlertTitle>{insight.title}</AlertTitle>
      <AlertDescription>
        <span className="grid gap-2">
          <span>{insight.description}</span>
          {/* `insights.*`, not new copy of its own: this is the same insight the
              authenticated Insights page renders, and two catalogues for one sentence is
              how the two surfaces come to word the same fact differently. */}
          <span className="text-sm text-fg-secondary">
            {t('insights.confidence')}{' '}
            <span className="font-mono tabular-nums">
              {t('insights.confidenceValue', {
                // `ReportAIInsightItem.ConfidenceScore` is an integer 0-100 — #152 was a
                // bug about reading a 0-1 confidence off the wrong model, so this is
                // printed as the percentage points it already is and never scaled.
                score: formatMetric(insight.confidenceScore, { kind: 'number' }, locale),
              })}
            </span>
          </span>
          {insight.recommendedActions.length > 0 && (
            <span className="grid gap-1">
              <span className="text-sm font-semibold text-fg-primary">
                {t('insights.recommendedActions')}
              </span>
              <ul className="list-disc pl-5 text-sm text-fg-secondary">
                {insight.recommendedActions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </span>
          )}
        </span>
      </AlertDescription>
    </Alert>
  )
}
