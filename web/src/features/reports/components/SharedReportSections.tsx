import { useTranslation } from '../../../i18n'
import { Card, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui'
import KpiTile from '../../../components/charts/KpiTile'
import { formatMetric } from '../../../components/charts/formatMetric'
import ResultsSuppressionNotice from '../../surveys/components/ResultsSuppressionNotice'
import { dimensionLabel } from '../../surveys/dimensionLabel'
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
                  {/* Through the product's own catalogue, not printed raw.
                      `SurveyResultsPage` does print `psychological_safety` verbatim, and
                      `dimensionLabel` says why that is right *there*: its reader is "an
                      analyst reading a key they will filter and export by". The reader
                      here is a board member, an auditor or a ministry contact who will
                      never filter anything, and `enps` tells them nothing. So this takes
                      the respondent's side of that split — the same lookup
                      `SurveyRespondForm` heads its sections with — which also prints an
                      uncatalogued category as its author wrote it rather than as
                      boilerplate. */}
                  <TableCell>{dimensionLabel(dimension.dimension, t)}</TableCell>
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
 * ## `affectedSegments` is deliberately not rendered
 *
 * It is the one omission on this page that is a judgement rather than a projection. It
 * is a free list of segment names written by the insight generator, and it passes
 * through none of the aggregation that applies the anonymity floor — so a small
 * department can be named there while the table above withholds its row, or a segment
 * too small to appear in that table at all can be named beside a finding about it.
 * Naming it on the most exposed page in the product is the wrong side of that argument
 * to be on. The authenticated Insights page shows it (`insights.affectedSegments`) and
 * should: its reader is inside the tenant.
 *
 * `SharedReportSections.test.tsx` pins the omission with a fixture whose segment names
 * appear nowhere else on the page, so a renderer that printed them — in any casing —
 * fails rather than merely differing from this paragraph.
 *
 * ## A card, not an `Alert`
 *
 * `Alert` defaults to `role="status"`, and a `status` is a live region: the reader's
 * screen reader announces it when it appears. These cards appear when the fetch
 * resolves, so a report with four insights announced four paragraphs of static report
 * prose as though they were status updates. An insight is content, not an event. `Card`
 * is what the product's other static panels use, and the title is a real `h3` under the
 * section's `h2`, which gives a screen-reader reader something to navigate by instead.
 */
function InsightCard({ insight }: { insight: ReportAIInsight }) {
  const { t, locale } = useTranslation()

  return (
    <Card className="gap-2 px-card py-3 text-lg shadow-none">
      {/* `mb-0` because `index.css` gives every bare heading a bottom margin, which
          would double up with the grid gap this card already spaces its rows by. */}
      <h3 className="mb-0 text-lg font-medium leading-normal text-fg-primary">
        {insight.title}
      </h3>
      <div className="grid gap-2 text-sm text-fg-secondary">
        <span>{insight.description}</span>
        {/* `insights.*`, not new copy of its own: this is the same insight the
            authenticated Insights page renders, and two catalogues for one sentence is
            how the two surfaces come to word the same fact differently. */}
        <span>
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
            <span className="font-semibold text-fg-primary">
              {t('insights.recommendedActions')}
            </span>
            <ul className="mb-0 list-disc pl-5">
              {insight.recommendedActions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </span>
        )}
      </div>
    </Card>
  )
}
