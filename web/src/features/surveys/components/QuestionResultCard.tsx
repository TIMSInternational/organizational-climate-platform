import { useTranslation } from '../../../i18n'
import { BarChart, WordCloud } from '../../../components/charts'
import { Badge, Body, Card, CardContent, CardHeader, CardTitle, Table } from '../../../components/ui'
import type { SurveyQuestionResult } from '../api/surveyResults'
import {
  RESPONSES_SERIES_KEY,
  bucketLabel,
  distributionChartData,
  isOpenEnded,
  wordCloudData,
} from '../surveyResultsView'

interface QuestionResultCardProps {
  question: SurveyQuestionResult
  /** Already-translated short identifier for the question, e.g. "Q3". */
  shortLabel: string
}

/**
 * One question's results.
 *
 * ## Which chart, and why
 *
 * - **Open-ended** → `WordCloud`, coloured by the language the answer was written in.
 *   There is no distribution to plot: the server returns word frequencies and never the
 *   verbatim text.
 * - **Everything else** → `BarChart` over the option buckets. A bar chart, not a pie:
 *   a Likert scale is an ordered comparison of magnitudes, and angle is harder to judge
 *   than length. `BarChart` leaves recharts' zero-anchored domain alone, which is the
 *   #79 bars-zero half of the rule — a count axis that did not start at zero would
 *   exaggerate the difference between two nearly-equal options.
 *
 * ## Counts, not percentages, on the axis
 *
 * The percentage is in the payload and is shown in the ranking table, but the bars are
 * counts. Percentages of differing answered counts are not comparable between questions
 * on one page, and this page shows many questions at once.
 *
 * ## The rows are in the server's order
 *
 * That is the question's configured option order. Sorting the bars by count would turn a
 * Likert scale into a ranking and destroy the only axis a scale question has.
 */
export default function QuestionResultCard({ question, shortLabel }: QuestionResultCardProps) {
  const { t } = useTranslation()

  const heading = question.text ?? t('surveyResults.untranslatedQuestion')
  const isRanking = question.distribution.some((bucket) => bucket.averageRank !== null)
  const chartData = distributionChartData(question)
  const series = [{ key: RESPONSES_SERIES_KEY, name: t('surveyResults.kpiResponses') }]

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {shortLabel} · {heading}
        </CardTitle>
        <span className="flex flex-wrap items-center gap-2">
          {/* `outline` and `secondary` are the only two badge variants measured to clear
              WCAG AA in BOTH themes -- see styles/badgeVariantContrast.test.ts. A
              light-mode-only contrast failure is this project's documented recurring
              blind spot, so do not swap in a hued variant because it looks better in
              dark. */}
          <Badge variant="outline">{question.type}</Badge>
          <Badge variant="secondary">
            {t('surveyResults.answeredCount', { count: question.answeredCount })}
          </Badge>
          {question.average !== null && (
            <Badge variant="secondary">
              {t('surveyResults.averageValue', { value: question.average })}
            </Badge>
          )}
          {question.median !== null && (
            <Badge variant="secondary">
              {t('surveyResults.medianValue', { value: question.median })}
            </Badge>
          )}
        </span>
      </CardHeader>

      <CardContent>
        {isOpenEnded(question) ? (
          <>
            <WordCloud
              data={wordCloudData(question)}
              colorBy="category"
              title={t('surveyResults.wordsIn', { question: heading })}
            />
            {question.suppressedWordCount > 0 && (
              // Withheld, not absent. A word that only one person used can name that
              // person to a colleague who recognises the phrasing, however many people
              // answered -- so the count is reported and the words are not.
              <Body className="text-fg-secondary">
                {t('surveyResults.wordsWithheld', { count: question.suppressedWordCount })}
              </Body>
            )}
          </>
        ) : (
          <BarChart
            data={chartData}
            series={series}
            title={t('surveyResults.distributionOf', { question: heading })}
          />
        )}

        {isRanking && (
          // A ranking's headline is the mean position, which is not a count and so has
          // no place on the bar axis. It gets a table of its own rather than a second
          // chart whose y-axis would silently mean something different.
          <Table className="text-sm">
            <caption className="sr-only">{t('surveyResults.rankingTableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('surveyResults.csvOptionLabel')}</th>
                <th scope="col">{t('surveyResults.averagePosition')}</th>
                <th scope="col">{t('surveyResults.kpiResponses')}</th>
              </tr>
            </thead>
            <tbody>
              {question.distribution.map((bucket) => (
                <tr key={bucket.value}>
                  <td>{bucketLabel(bucket)}</td>
                  <td>{bucket.averageRank ?? t('surveyResults.notApplicable')}</td>
                  <td>{bucket.count}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
