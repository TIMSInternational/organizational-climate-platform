import { useTranslation } from '../../../i18n'
import { BarChart, ProtectedCell, formatMetric } from '../../../components/charts'
import { Body, Button, EmptyState, H3, Table } from '../../../components/ui'
import { cn } from '../../../lib/cn'
import type { SurveyBreakdown, SurveyQuestionResult, SurveySegmentResult } from '../api/surveyResults'
import {
  OVERALL_SERIES_KEY,
  SEGMENT_SERIES_KEY,
  disclosedSegments,
  segmentComparisonData,
} from '../surveyResultsView'

interface SegmentBreakdownPanelProps {
  breakdown: SurveyBreakdown
  questions: readonly SurveyQuestionResult[]
  /** The segment floor the server applied. */
  minimumGroupSize: number
  /** Already-translated short identifier for a question, e.g. "Q3". */
  questionLabel: (question: SurveyQuestionResult) => string
  /** The segment the reader has drilled into, if any. */
  selectedKey: string | null
  onSelect: (key: string | null) => void
}

/**
 * One dimension's breakdown: the table of every group, and the drill-down.
 *
 * ## The privacy obligation, and where it is discharged
 *
 * `SurveyAggregation` withholds any segment below `MinimumSegmentRespondents` — it
 * arrives with `isSuppressed: true`, `respondentCount: 0` and `questions: []`. Three
 * things follow, and all three are the reason this component exists rather than a plain
 * table:
 *
 * 1. **The row is still rendered**, in the `ProtectedCell` grammar. Dropping it would
 *    make a partial breakdown read as a complete one, which is a stronger claim than
 *    the data supports and the specific failure #123 calls out.
 * 2. **The zero is never printed.** `respondentCount: 0` on a suppressed segment is the
 *    absence of a measurement, not a measurement of zero; printing it says nobody in
 *    that group responded, which is false and is also exactly the number a reader would
 *    use to reconstruct the group by subtracting from the total.
 * 3. **A withheld group's participation is withheld with it.** The rate arrives null
 *    and the `headcount` denominator arrives null with it, and this panel prints
 *    neither — a percentage over a known headcount is one division away from the count
 *    the floor protects, and the footer says so in words.
 *
 * The footer reports how many groups were withheld and what the floor is. It does
 * **not** report how many people are behind them, and nothing on this panel is
 * computed from `suppressedRespondentCount`: that number is the withheld headcount,
 * and publishing it — directly, or as one half of a pair a reader subtracts —
 * hands over exactly what the floor protects. The *unsegmented* count is reported
 * separately, because it is a different fact: one group was measured and hidden,
 * the other was never in a group at all.
 *
 * The sequential heat strip this panel used to render under the table is gone — the
 * admin round dropped it, because the climate map above already answers "group ×
 * dimension" on the diverging ramp and one page must not carry two encodings of one
 * comparison. The inline comment at its old position holds the pointer.
 */
export default function SegmentBreakdownPanel({
  breakdown,
  questions,
  minimumGroupSize,
  questionLabel,
  selectedKey,
  onSelect,
}: SegmentBreakdownPanelProps) {
  const { t, locale } = useTranslation()

  const dimensionName =
    breakdown.dimension === 'department' ? t('surveyResults.dimensionDepartment') : breakdown.dimension

  const nameOf = (segment: SurveySegmentResult) => segment.label ?? segment.key
  const selected = disclosedSegments(breakdown).find((segment) => segment.key === selectedKey) ?? null

  if (breakdown.segments.length === 0 && breakdown.unsegmentedRespondentCount === 0) {
    return (
      <EmptyState
        title={t('surveyResults.noSegments')}
        description={t('surveyResults.noSegmentsDescription')}
      />
    )
  }

  return (
    <section>
      <H3>{dimensionName}</H3>

      <Table>
        <caption className="sr-only">
          {t('surveyResults.segmentTableCaption', { dimension: dimensionName })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('surveyResults.segment')}</th>
            <th scope="col">{t('surveyResults.respondents')}</th>
            <th scope="col">{t('surveyResults.participationRate')}</th>
            <th scope="col">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.segments.map((segment) => (
            <tr
              key={segment.key}
              // The findings column's drill-down lands here: the selected group's
              // row is tinted so the eye finds it after the scroll, the same
              // `hi` treatment the prototype draws. The tint marks the row; the
              // open detail below is what it means.
              className={cn(selectedKey === segment.key && 'bg-accent-blue-soft')}
            >
              <th scope="row">{nameOf(segment)}</th>
              {segment.isSuppressed ? (
                // ONE cell spanning the measurements, holding the suppression
                // grammar rather than the number. Two cells each saying "withheld"
                // would read as two withheld measurements; this reads as one
                // withheld group, which is what it is. The grammar is
                // `ProtectedCell`'s — hatched box, padlock, the word — the same
                // mark the climate map two sections above hatches this group's
                // row with, so "protected" is learned once and read twice.
                <td colSpan={2}>
                  <span className="flex flex-wrap items-center gap-2">
                    <ProtectedCell
                      // 0, not the respondent count: the server already zeroed it,
                      // and the withheld figure has no business travelling further
                      // down than it must.
                      responses={0}
                      threshold={minimumGroupSize}
                      description={nameOf(segment)}
                      suppressedClassName="h-[18px] w-7"
                    >
                      {null}
                    </ProtectedCell>
                    <span className="text-fg-secondary">
                      {t('surveyResults.withheldSegmentExplanation', { minimum: minimumGroupSize })}
                    </span>
                  </span>
                </td>
              ) : (
                <>
                  <td className="font-mono tabular-nums">{segment.respondentCount}</td>
                  <td>
                    {/* Through `Intl`, not `${n}%`: Spanish renders `78 %` with a space
                        and English `78%`, and neither is spelled out here. See
                        charts/formatMetric.ts for the three bugs the legacy
                        concatenation shipped. */}
                    {segment.participationRate === null ? (
                      t('surveyResults.notApplicable')
                    ) : (
                      <>
                        <span className="font-mono tabular-nums">
                          {formatMetric(segment.participationRate, { kind: 'percentage' }, locale)}
                        </span>
                        {/* The denominator, beside the rate it explains. Only from
                            `headcount` — the server nulls it for a withheld group,
                            so this branch cannot print half of the division the
                            floor keeps apart. */}
                        {segment.headcount !== null && (
                          <span className="text-fg-secondary">
                            {' '}
                            {t('surveyResults.ofPeople', { count: segment.headcount })}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                </>
              )}
              <td>
                {segment.isSuppressed ? null : (
                  <Button
                    variant="ghost"
                    onClick={() => onSelect(selectedKey === segment.key ? null : segment.key)}
                  >
                    {selectedKey === segment.key
                      ? t('surveyResults.hideDetail')
                      : t('surveyResults.showDetail')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {breakdown.unsegmentedRespondentCount > 0 && (
            <tr>
              <th scope="row">{t('surveyResults.unsegmented')}</th>
              <td>{breakdown.unsegmentedRespondentCount}</td>
              <td>{t('surveyResults.notApplicable')}</td>
              <td />
            </tr>
          )}
        </tbody>
      </Table>

      {/* How many groups, and what the floor is — never how many people are behind
          them. `breakdown.suppressedRespondentCount` is the withheld headcount and
          is deliberately not read here, in any form: printing it, or printing
          anything it can be recovered from by one subtraction, publishes the exact
          sub-threshold count the floor exists to hide. The sentence that used to
          follow this one said "Showing 171 of 175 completed responses", whose two
          numbers differ by precisely that count. */}
      <Body className="text-fg-secondary">
        {breakdown.suppressedSegmentCount > 0
          ? t('surveyResults.segmentsWithheld', {
              segments: breakdown.suppressedSegmentCount,
              minimum: minimumGroupSize,
            })
          : t('surveyResults.nothingWithheld')}
      </Body>

      {/* No heat strip here, deliberately (the admin round dropped it): the
          climate map two sections up already answers "group × dimension" on the
          diverging ramp, and a sequential teal grid of near-identical data
          directly below it put two encodings of one comparison on one page.
          The drill-down below is the panel's own detail view. */}

      {selected && (
        <section>
          <H3>{t('surveyResults.segmentDetail', { segment: nameOf(selected) })}</H3>
          <BarChart
            data={segmentComparisonData(selected, questions, questionLabel)}
            series={[
              { key: SEGMENT_SERIES_KEY, name: t('surveyResults.seriesSegment') },
              { key: OVERALL_SERIES_KEY, name: t('surveyResults.seriesOverall') },
            ]}
            title={t('surveyResults.segmentComparisonTitle')}
          />
        </section>
      )}
    </section>
  )
}
