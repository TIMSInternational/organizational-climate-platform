import { useTranslation } from '../../../i18n'
import { Card, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui'
import KpiTile from '../../../components/charts/KpiTile'
import ProtectedCell from '../../../components/charts/ProtectedCell'
import { formatMetric } from '../../../components/charts/formatMetric'
import ResultsSuppressionNotice from '../../surveys/components/ResultsSuppressionNotice'
import { dimensionLabel } from '../../surveys/dimensionLabel'
import type { SurveyQuestionResult } from '../../surveys/api/surveyResults'
import type {
  ReportAIInsight,
  ReportBenchmarkComparison,
  ReportDemographicBreakdown,
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
 *
 * A withheld **demographic group** keeps its row too, and gets the `ProtectedCell`
 * grammar the rest of the product uses for a withheld reading — a hatched, padlocked
 * box with the word *protected* beside it, spanning the measurement columns. Never a
 * blank cell and never a zero: `respondentCount` is 0 on a suppressed group because the
 * server zeroed it, and printing that zero would claim nobody in the group answered,
 * which is false and is also the number a reader subtracts with.
 *
 * ## Open text is a frequency map, and this renderer cannot make it anything else
 *
 * The word list prints a word, the language it was written in, and two counts. It never
 * joins two words, never renders a phrase and never shows a sample answer — this
 * platform returns no verbatim open-text content anywhere, which is the basis on which
 * "Voices" was closed for good. The guarantee is structural rather than editorial:
 * `reportDocument.ts` copies only `{ language, word, count, responseCount }` and drops
 * any entry that is not a single token, so there is no sentence in the parsed document
 * for this file to print even if it tried.
 *
 * `suppressedWordCount` is rendered whenever it is non-zero, because "withheld" and
 * "none" are different statements: a list that quietly shortened itself tells the
 * reader they are looking at everything people said.
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

      {document.benchmarks.length > 0 && (
        <section className="grid gap-panel-gap" aria-labelledby="shared-report-benchmarks">
          <h2 id="shared-report-benchmarks" className="text-lg font-semibold text-fg-primary">
            {t('sharedReport.benchmarksHeading')}
          </h2>
          {document.benchmarks.map((benchmark) => (
            <BenchmarkBlock key={benchmark.benchmarkId} benchmark={benchmark} />
          ))}
        </section>
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

      {/* Which language the *authored* text below is in — the question text, the option
          labels, the author's own category names. A report is a company document with
          no `?lang` to honour, so the server resolves it from the survey's own language
          and prints the answer on the section; a reader of a stored document has no
          other way to know. Deliberately not the reader's UI language, which the
          language picker in the shell already controls and which does not move a word
          of the content. */}
      {section.resolvedLocale !== '' && (
        <p className="max-w-prose text-sm text-fg-secondary">
          {t('sharedReport.contentLanguage', {
            language: contentLanguageName(t, section.resolvedLocale),
          })}
        </p>
      )}

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

      {/* `!section.isSuppressed` restated at the render site, and not because the list
          might be non-empty: `sectionOf` already empties both of these for a suppressed
          section, mirroring the server, which already emptied them too. It is here as
          the third statement of one rule, at the only layer a reader of this file can
          check — these two blocks are the withheld data itself, per-question
          distributions, word clouds and per-group scores. */}
      {!section.isSuppressed &&
        section.demographics.map((breakdown) => (
          <DemographicBreakdown
            key={breakdown.dimension}
            breakdown={breakdown}
            minimumGroupSize={section.minimumGroupSize}
          />
        ))}

      {!section.isSuppressed && section.questions.length > 0 && (
        <>
          <h3 className="mb-0 text-base font-semibold text-fg-primary">
            {t('sharedReport.questionsHeading')}
          </h3>
          {section.questions.map((question) => (
            <QuestionBlock key={question.questionId} question={question} />
          ))}
        </>
      )}
    </section>
  )
}

/**
 * `'en' | 'es'` as a name a reader recognises, falling back to the server's own value.
 *
 * The same lookup and the same fallback as `ResultsContentLanguageNotice`: printing
 * `sharedReport.languageXx` at a reader is worse than printing the code the server sent.
 * `resolvedLocale` is a resolved *locale*, so unlike a survey's authored language it is
 * never `both` — the server picked one before it printed a word.
 */
function contentLanguageName(t: (key: string) => string, locale: string): string {
  const keys: Record<string, string> = { en: 'language.english', es: 'language.spanish' }
  const key = keys[locale]
  return key ? t(key) : locale
}

/**
 * One question: its distribution, or its word frequencies.
 *
 * ## Branching on the data, not on the type string
 *
 * `QuestionResultCard` asks `isOpenEnded(question)`, which is the right question to ask
 * of a payload fetched from the API a moment ago. This document is different in kind:
 * `reports.report_output` is a stored artefact that can be older than the client
 * reading it — the argument `reportDocument.ts` opens with — so a question whose `type`
 * this build does not recognise is a case that actually arrives here. Branching on the
 * type would drop that question's word cloud on the floor without a word to say so.
 *
 * So a distribution renders when there is one, a word list renders when there are words
 * *or* something was withheld from them, and a question with neither says so.
 */
function QuestionBlock({ question }: { question: SurveyQuestionResult }) {
  const { t } = useTranslation()

  const heading = question.text ?? t('surveyResults.untranslatedQuestion')
  const hasWords = question.words.length > 0 || question.suppressedWordCount > 0

  return (
    <div className="grid gap-2">
      <h4 className="mb-0 text-base font-medium leading-normal text-fg-primary">{heading}</h4>
      <p className="mb-0 text-sm text-fg-secondary">
        {t('surveyResults.answeredCount', { count: question.answeredCount })}
      </p>

      {question.distribution.length > 0 && <DistributionTable question={question} />}
      {hasWords && <WordFrequencies question={question} />}
      {question.distribution.length === 0 && !hasWords && (
        <p className="mb-0 max-w-prose text-sm text-fg-secondary">
          {t('sharedReport.noDistribution')}
        </p>
      )}
    </div>
  )
}

/**
 * One question's option buckets, in the survey's own option order.
 *
 * Not sorted by count: a Likert scale is an ordered comparison, and re-ordering the
 * rows by popularity destroys the only axis it has. The percentage is the server's
 * `percentage` field printed as it arrived — a share recomputed here as count over
 * answered count would be arithmetic performed outside the aggregation, which is the
 * one thing this file's header promises it never does.
 */
function DistributionTable({ question }: { question: SurveyQuestionResult }) {
  const { t, locale } = useTranslation()
  const isRanking = question.distribution.some((bucket) => bucket.averageRank !== null)

  return (
    <Table className="text-sm">
      <TableCaption>{t('surveyResults.distributionOf', { question: question.text ?? t('surveyResults.untranslatedQuestion') })}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{t('surveyResults.csvOptionLabel')}</TableHead>
          <TableHead>{t('surveyResults.kpiResponses')}</TableHead>
          <TableHead>{t('sharedReport.share')}</TableHead>
          {isRanking && <TableHead>{t('surveyResults.averagePosition')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {question.distribution.map((bucket) => (
          <TableRow key={bucket.value}>
            {/* `label ?? value`, the product's own `bucketLabel` rule: the label is
                resolved for the section's locale and the stable value is what a bare
                scale point has instead of one. */}
            <TableCell>{bucket.label ?? bucket.value}</TableCell>
            <TableCell className="font-mono tabular-nums">
              {bucket.count.toLocaleString(locale)}
            </TableCell>
            <TableCell className="font-mono tabular-nums">
              {formatMetric(bucket.percentage, { kind: 'percentage' }, locale)}
            </TableCell>
            {isRanking && (
              <TableCell className="font-mono tabular-nums">
                {bucket.averageRank === null
                  ? t('surveyResults.notApplicable')
                  : bucket.averageRank.toLocaleString(locale, { maximumFractionDigits: 2 })}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * An open question's word cloud, as a report prints it: **words and counts, never text**.
 *
 * Each word is its own table cell with two numbers between it and the next one, so the
 * page has no place a phrase could be assembled — deliberately, and it is why this is a
 * table rather than the `WordCloud` component the authenticated results page uses. A
 * cloud is a picture of relative frequency; a table of the same frequencies is the
 * shape a report reader can check, and neither can carry a sentence.
 *
 * `wordsFrequencyOnly` states the rule to the reader in their own language, and
 * `surveyResults.wordsWithheld` — the authenticated page's own sentence, not a second
 * wording of it — reports how many distinct words were withheld for appearing in too
 * few answers. Rendering that count is not optional: a floored list shown without it
 * reads as the complete set of what people said.
 */
function WordFrequencies({ question }: { question: SurveyQuestionResult }) {
  const { t, locale } = useTranslation()

  return (
    <>
      {question.words.length > 0 ? (
        <Table className="text-sm">
          <TableCaption>
            {t('surveyResults.wordsIn', {
              question: question.text ?? t('surveyResults.untranslatedQuestion'),
            })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sharedReport.word')}</TableHead>
              <TableHead>{t('sharedReport.wordLanguage')}</TableHead>
              <TableHead>{t('sharedReport.wordMentions')}</TableHead>
              <TableHead>{t('sharedReport.wordAnswers')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {question.words.map((word) => (
              <TableRow key={`${word.language}:${word.word}`}>
                <TableCell>{word.word}</TableCell>
                <TableCell>{contentLanguageName(t, word.language)}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {word.count.toLocaleString(locale)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {word.responseCount.toLocaleString(locale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="mb-0 max-w-prose text-sm text-fg-secondary">{t('sharedReport.noWords')}</p>
      )}

      <p className="mb-0 max-w-prose text-sm text-fg-secondary">
        {t('sharedReport.wordsFrequencyOnly')}
      </p>

      {question.suppressedWordCount > 0 && (
        <p className="mb-0 max-w-prose text-sm text-fg-secondary">
          {t('surveyResults.wordsWithheld', { count: question.suppressedWordCount })}
        </p>
      )}
    </>
  )
}

/**
 * One demographic dimension — tenure, role, location — and how each of its groups
 * answered.
 *
 * ## The columns are the union of the disclosed groups' dimensions
 *
 * A group's scores arrive as rows (`{ dimension, averageScore }`), not as a fixed set,
 * because the server keys them on a question category a survey author typed. The
 * columns are therefore collected from the groups that have any — from the **disclosed**
 * groups only, which costs nothing, since a suppressed group arrives with no scores at
 * all and could not contribute a column if it tried.
 *
 * ## A withheld group, and what is not printed for it
 *
 * The row stays, named, and its measurements collapse into one cell carrying the
 * `ProtectedCell` grammar: hatched, padlocked, the word *protected*, and the sentence
 * the authenticated breakdown uses for the same state. One cell rather than one per
 * column, because several cells each saying "withheld" reads as several withheld
 * measurements instead of one withheld group.
 *
 * `suppressedRespondentCount` — the withheld headcount — is not rendered, in any form,
 * and nothing here is computed from it. `SegmentBreakdownPanel` refuses it for the
 * reason that applies here twice over: this page is unauthenticated, and a number a
 * reader recovers by one subtraction is the sub-threshold count the floor exists to
 * hide. The count of withheld *groups* is reported, which names nobody.
 */
function DemographicBreakdown({
  breakdown,
  minimumGroupSize,
}: {
  breakdown: ReportDemographicBreakdown
  minimumGroupSize: number
}) {
  const { t, locale } = useTranslation()

  const columns: string[] = []
  for (const segment of breakdown.segments) {
    for (const score of segment.dimensions) {
      if (!columns.includes(score.dimension)) columns.push(score.dimension)
    }
  }

  // The dimension key as the demographic field was named — `dimensionLabel` translates
  // question categories, and this is a `response_demographics` key, a different
  // namespace that would resolve to nothing and print a slug back at the reader.
  const dimensionName = breakdown.dimension

  return (
    <>
      <Table className="text-sm">
        <TableCaption>
          {t('sharedReport.demographicsCaption', { dimension: dimensionName })}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t('surveyResults.segment')}</TableHead>
            <TableHead>{t('surveyResults.respondents')}</TableHead>
            {columns.map((column) => (
              <TableHead key={column}>{dimensionLabel(column, t)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {breakdown.segments.map((segment) => (
            <TableRow key={segment.key}>
              <TableCell>{segment.label ?? segment.key}</TableCell>
              {segment.isSuppressed ? (
                // One cell over the respondents column and every score column. `colSpan`
                // counts them so a new column cannot leave a blank box beside the hatch
                // — a blank box is the "reads as missing data" failure `ProtectedCell`
                // exists to deny.
                <TableCell colSpan={columns.length + 1}>
                  <span className="flex flex-wrap items-center gap-2">
                    <ProtectedCell
                      // 0, never `segment.respondentCount`: the server zeroed it, the
                      // parser zeroes it again, and the withheld figure has no business
                      // travelling any further than it must.
                      responses={0}
                      threshold={minimumGroupSize}
                      description={segment.label ?? segment.key}
                      suppressedClassName="h-[18px] w-7"
                    >
                      {null}
                    </ProtectedCell>
                    <span className="text-fg-secondary">
                      {t('surveyResults.withheldSegmentExplanation', {
                        minimum: minimumGroupSize,
                      })}
                    </span>
                  </span>
                </TableCell>
              ) : (
                <>
                  <TableCell className="font-mono tabular-nums">
                    {segment.respondentCount.toLocaleString(locale)}
                  </TableCell>
                  {columns.map((column) => {
                    const score = segment.dimensions.find((row) => row.dimension === column)
                    return (
                      <TableCell key={column} className="font-mono tabular-nums">
                        {score === undefined || score.averageScore === null
                          ? t('surveyResults.notApplicable')
                          : score.averageScore.toLocaleString(locale, {
                              maximumFractionDigits: 2,
                            })}
                      </TableCell>
                    )
                  })}
                </>
              )}
            </TableRow>
          ))}

          {/* People who carry no value for this field at all — measured, in no group,
              and counted here so the groups reconcile against the participation
              counters rather than appearing to lose people. A different fact from a
              withheld group, and it must not be dressed as one. */}
          {breakdown.unsegmentedRespondentCount > 0 && (
            <TableRow>
              <TableCell>{t('surveyResults.unsegmented')}</TableCell>
              <TableCell className="font-mono tabular-nums">
                {breakdown.unsegmentedRespondentCount.toLocaleString(locale)}
              </TableCell>
              {columns.map((column) => (
                <TableCell key={column} className="font-mono tabular-nums">
                  {t('surveyResults.notApplicable')}
                </TableCell>
              ))}
            </TableRow>
          )}
        </TableBody>
      </Table>

      {breakdown.suppressedSegmentCount > 0 && (
        <p className="max-w-prose text-sm text-fg-secondary">
          {t('sharedReport.groupsWithheld', {
            count: breakdown.suppressedSegmentCount,
            minimum: minimumGroupSize,
          })}
        </p>
      )}
    </>
  )
}

/**
 * One benchmark, read against its own prior period.
 *
 * ## Nothing here subtracts anything
 *
 * `delta` and `changeRatio` are printed as the server computed them, through
 * `BenchmarkPriorPeriod.BuildChanges` — the same code `GET /admin/benchmarks/{id}`
 * serves, so a report cannot print a year-over-year figure the benchmark page disagrees
 * with. A client that filled a null `delta` by differencing the two values beside it
 * would break that guarantee in the one case it exists for, below.
 *
 * ## The units-differ case gets a reason, not a dash
 *
 * `BenchmarkMetric.Unit` is a free string, so the same metric can arrive as `s` one
 * year and `ms` the next, and 1.2 against 1200 reads as a catastrophe rather than as
 * the same number twice. The server compares units first and withholds the change,
 * reporting both units so a caller can **say why**. Saying why is this component's half
 * of that bargain: a dash would look like missing data and invite the reader to do the
 * subtraction themselves.
 *
 * ## Three different reasons there is no prior period
 *
 * `none` (an administrator has said there is none), `unlinked` (nobody has linked one
 * yet) and a `linked` benchmark whose prior period is outside what this company may
 * read are three different facts, and `priorPeriodStatus` is the only thing that tells
 * them apart. A status this client does not recognise falls to the third sentence,
 * which is the one that stays true whatever the reason: it is not in this report.
 */
function BenchmarkBlock({ benchmark }: { benchmark: ReportBenchmarkComparison }) {
  const { t, locale } = useTranslation()
  const headingId = `shared-report-benchmark-${benchmark.benchmarkId}`
  const prior = benchmark.priorPeriod

  const priorStatement =
    prior !== null
      ? t('sharedReport.comparedWith', { name: prior.name })
      : benchmark.priorPeriodStatus === 'none'
        ? t('sharedReport.priorPeriodNone')
        : benchmark.priorPeriodStatus === 'unlinked'
          ? t('sharedReport.priorPeriodUnlinked')
          : t('sharedReport.priorPeriodUnavailable')

  return (
    <section className="grid gap-2" aria-labelledby={headingId}>
      <h3 id={headingId} className="mb-0 text-base font-semibold text-fg-primary">
        {benchmark.name}
      </h3>
      <p className="mb-0 max-w-prose text-sm text-fg-secondary">
        {t('sharedReport.benchmarkCategory', { category: benchmark.category })}
        {/* A global benchmark — `companyId: null` — is a row every tenant compares
            against rather than one of this organisation's own measurements, and a
            reader comparing themselves to it should know which they are looking at. */}
        {benchmark.companyId === null && <> · {t('sharedReport.benchmarkGlobal')}</>}
      </p>
      <p className="mb-0 max-w-prose text-sm text-fg-secondary">{priorStatement}</p>

      {prior !== null && prior.metrics.length > 0 && (
        <Table className="text-sm">
          <TableCaption>
            {t('sharedReport.benchmarkCaption', { benchmark: benchmark.name })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sharedReport.metric')}</TableHead>
              <TableHead>{t('common.value')}</TableHead>
              <TableHead>{t('sharedReport.priorValue')}</TableHead>
              <TableHead>{t('sharedReport.delta')}</TableHead>
              <TableHead>{t('sharedReport.changeRatio')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prior.metrics.map((change) => {
              // The one case the server withholds a change it could otherwise compute.
              // Both sides are present, so "not recorded" would be a lie and a dash
              // would be an invitation.
              const unitsDiffer =
                change.delta === null &&
                change.value !== null &&
                change.priorValue !== null &&
                change.unit !== change.priorUnit

              return (
                <TableRow key={change.metricName}>
                  <TableCell>{change.metricName}</TableCell>
                  <TableCell className="font-mono tabular-nums">
                    <Reading value={change.value} unit={change.unit} />
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    <Reading value={change.priorValue} unit={change.priorUnit} />
                  </TableCell>
                  {unitsDiffer ? (
                    <TableCell colSpan={2} className="text-fg-secondary">
                      {t('sharedReport.unitsDiffer', {
                        unit: change.unit ?? '',
                        priorUnit: change.priorUnit ?? '',
                      })}
                    </TableCell>
                  ) : (
                    <>
                      <TableCell className="font-mono tabular-nums">
                        {change.delta === null
                          ? t('surveyResults.notApplicable')
                          : change.delta.toLocaleString(locale, {
                              maximumFractionDigits: 2,
                              signDisplay: 'exceptZero',
                            })}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {/* `changeRatio` is a FRACTION — 0.057, not 5.7 — so `Intl`
                            does the ×100 as part of formatting it. Multiplying first
                            and appending a `%` is the concatenation bug formatMetric.ts
                            was written to end, and it also loses the Spanish space. */}
                        {change.changeRatio === null
                          ? t('surveyResults.notApplicable')
                          : change.changeRatio.toLocaleString(locale, {
                              style: 'percent',
                              maximumFractionDigits: 1,
                              signDisplay: 'exceptZero',
                            })}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {prior === null && benchmark.metrics.length > 0 && (
        <Table className="text-sm">
          {/* A caption of its own, not `benchmarkCaption`: this table has no prior
              period in it, and "against the same reading a period earlier" over two
              columns of current readings describes a comparison that is not there. The
              assertions in this file could not see it — the string was present and
              correct for the other table — and the screenshot could. */}
          <TableCaption>
            {t('sharedReport.benchmarkReadingsCaption', { benchmark: benchmark.name })}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sharedReport.metric')}</TableHead>
              <TableHead>{t('common.value')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {benchmark.metrics.map((metric) => (
              <TableRow key={metric.id}>
                <TableCell>{metric.metricName}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  <Reading value={metric.value} unit={metric.unit} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

/**
 * One benchmark reading: the number, and the unit it was recorded in beside it.
 *
 * The unit is the server's own free string and is printed rather than interpreted —
 * this component has no table of units and must not grow one, because deciding that
 * `pct` and `percent` are the same thing is precisely the judgement `BuildChanges`
 * refuses to make before it withholds a delta.
 */
function Reading({ value, unit }: { value: number | null; unit: string | null }) {
  const { t, locale } = useTranslation()

  if (value === null) return <span className="text-fg-secondary">{t('sharedReport.notRecorded')}</span>

  return (
    <>
      {value.toLocaleString(locale, { maximumFractionDigits: 2 })}
      {unit !== null && unit !== '' && <span className="text-fg-secondary"> {unit}</span>}
    </>
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
