import type {
  SurveyDistributionBucket,
  SurveyQuestionResult,
  SurveyResultsSummary,
  SurveyWordFrequency,
} from '../surveys/api/surveyResults'

/**
 * The document persisted in `reports.report_output`, as a client can safely read it.
 *
 * ## Why this is a parser and not just an interface
 *
 * `ReportDetail.ReportOutput` (ReportDtos.cs) is a **`string?` holding JSON**, not a
 * nested object: `ReportGeneration` serialises a `ReportOutputDocument` into the column
 * and the endpoint hands the column back verbatim. So every consumer has to
 * `JSON.parse` it, and a consumer that parses and then casts — `JSON.parse(raw) as
 * ReportDocument` — has told the type checker a lie it cannot check. The column is
 * written by one generator today, but it is a text column: an older row, a row written
 * by a previous version of the generator, or a `null` from a report that failed to
 * generate all arrive through the same field, and a cast turns each of them into a page
 * that throws while reading `.surveys.map`.
 *
 * That matters more here than it would elsewhere, because the first consumer is
 * `SharedReportPage` — an **unauthenticated** page whose visitor has no session to fall
 * back to, no navigation to escape with, and no way to tell a crashed render from a
 * revoked link. A render that throws there is indistinguishable from the product being
 * broken.
 *
 * So this module parses defensively and returns `null` for anything it cannot vouch
 * for. `null` means "there is no document", which every caller must already handle:
 * `report_output` is nullable on the entity.
 *
 * ## What it does NOT do
 *
 * It does not recompute, round, floor or infer anything. Every field is carried across
 * exactly as it arrived, or dropped. That rule is load-bearing for suppression:
 * `IsSuppressed` is the aggregation's own decision, and `ReportDepartmentParticipation`
 * documents that a suppressed department's `RespondentCount` has already been zeroed
 * server-side. A parser that "helpfully" filled a missing count from somewhere else
 * would be reconstructing the number the server withheld.
 */

/**
 * One department's participation as a report prints it — `ReportDepartmentParticipation`
 * in ReportDtos.cs.
 *
 * `respondentCount` is **already zero** when `isSuppressed` is true; the server zeroes
 * it so a withheld department's headcount does not exist in the document at all.
 * Renderers must branch on `isSuppressed` rather than on the count, because zero is
 * also a real answer for a department nobody in which responded.
 */
export interface ReportDepartmentParticipation {
  departmentId: string
  name: string | null
  respondentCount: number
  participationRate: number | null
  isSuppressed: boolean
}

/** One dimension's score — `SurveyDimensionResult` in SurveyResultsDtos.cs. */
export interface ReportDimensionScore {
  dimension: string
  questionCount: number
  answeredCount: number
  averageScore: number | null
}

/**
 * One dimension's score inside ONE demographic group — `ReportSegmentDimensionScore`.
 *
 * `averageScore` is null when the group answered nothing scoreable in this dimension.
 * "No score" and "zero" are different claims and the server keeps them apart, so a
 * renderer must too.
 */
export interface ReportSegmentDimensionScore {
  dimension: string
  averageScore: number | null
}

/**
 * One demographic group as a report prints it — `ReportSegmentParticipation`.
 *
 * The same contract as `ReportDepartmentParticipation`, applied to a group that has no
 * headcount: `respondentCount` is **already zero** and `dimensions` **already empty**
 * when `isSuppressed` is true, because the aggregation zeroed and emptied them before
 * the projection ever saw the group. `key` is the stable, locale-independent value the
 * aggregation grouped on; `label` is the reader-facing name when the field has one.
 */
export interface ReportSegmentParticipation {
  key: string
  label: string | null
  respondentCount: number
  isSuppressed: boolean
  dimensions: ReportSegmentDimensionScore[]
}

/**
 * One demographic dimension of a survey — `ReportDemographicBreakdown`.
 *
 * Department is deliberately not one of these: it has a denominator and a participation
 * rate, and it is printed as `ReportSurveySection.departments`.
 *
 * `suppressedRespondentCount` is the withheld headcount. It is carried because the
 * document carries it, and it is **not rendered anywhere** — printing it, or printing
 * anything one subtraction recovers it from, publishes the exact sub-threshold count
 * the floor exists to hide. `SegmentBreakdownPanel` makes the same refusal in the
 * authenticated product for the same reason.
 */
export interface ReportDemographicBreakdown {
  dimension: string
  segments: ReportSegmentParticipation[]
  suppressedSegmentCount: number
  suppressedRespondentCount: number
  unsegmentedRespondentCount: number
}

/**
 * One survey's section of a report — `ReportSurveySection` in ReportDtos.cs.
 *
 * `participation` is populated even below the disclosure floor ("a count identifies
 * nobody"), while `dimensions` is empty whenever `isSuppressed` is true. The two
 * together are why a renderer cannot infer "suppressed" from an empty list: a survey
 * with no scale questions has no dimensions and is not suppressed at all.
 */
export interface ReportSurveySection {
  surveyId: string
  title: string | null
  status: string
  /**
   * The locale the printed question text, option labels and scale anchors are in —
   * `en` or `es`, resolved from the survey's own language because a report is a company
   * document with no `?lang` to honour.
   *
   * A reader of the stored document has no other way to know which language they are
   * looking at, which is why the server started sending it when the section started
   * printing authored text.
   */
  resolvedLocale: string
  participation: SurveyResultsSummary
  /**
   * The per-question results **verbatim** — the same `SurveyQuestionResult` the results
   * screen is served, distributions and all.
   *
   * `words` is the only open-text surface this platform has and it is a **frequency
   * map**: a word, the language it was written in, and two counts. Verbatim response
   * text is not carried by this type on the wire and is not carried by it here, so a
   * renderer has nothing to reconstruct a sentence out of. `suppressedWordCount` says
   * how many distinct words were withheld for appearing in too few answers.
   *
   * Empty when `isSuppressed` is true.
   */
  questions: SurveyQuestionResult[]
  dimensions: ReportDimensionScore[]
  departments: ReportDepartmentParticipation[]
  suppressedDepartmentCount: number
  suppressedRespondentCount: number
  unsegmentedRespondentCount: number
  /** Every non-department breakdown the aggregation produced. Empty when `isSuppressed`. */
  demographics: ReportDemographicBreakdown[]
  isSuppressed: boolean
  /** A machine-readable code, e.g. `below_minimum_respondents`. Never display copy. */
  suppressionReason: string | null
  minimumGroupSize: number
}

/** One reading of a benchmark — `BenchmarkMetricDto` in BenchmarkDtos.cs. */
export interface ReportBenchmarkMetric {
  id: string
  metricName: string
  value: number
  unit: string
  percentile: number | null
  sampleSize: number | null
}

/**
 * One metric read against the same metric in the prior period —
 * `BenchmarkMetricChangeDto`.
 *
 * `delta` is null when either side is missing **or when the two sides are recorded in
 * different units** — subtracting a percentage from a point score produces a
 * confidently wrong number, which is the failure #89 exists to avoid. Both units are
 * carried so a renderer can say *why* the change is absent instead of printing a dash.
 *
 * `changeRatio` is a **fraction** (0.057, not 5.7), null when `delta` is null and null
 * when `priorValue` is zero.
 */
export interface ReportBenchmarkMetricChange {
  metricName: string
  value: number | null
  unit: string | null
  priorValue: number | null
  priorUnit: string | null
  delta: number | null
  changeRatio: number | null
}

/** The prior period a benchmark links to — `BenchmarkPriorPeriodDto`. */
export interface ReportBenchmarkPriorPeriod {
  id: string
  name: string
  /** Every metric named by **either** period; see `BenchmarkPriorPeriod.BuildChanges`. */
  metrics: ReportBenchmarkMetricChange[]
}

/**
 * One benchmark of the report's company, read against its own prior period —
 * `ReportBenchmarkComparison` in ReportDtos.cs.
 *
 * `companyId` is null for a global benchmark, the rows every tenant compares against.
 *
 * `priorPeriod` is null for three different reasons and `priorPeriodStatus` is the only
 * thing that tells them apart: `none` (an administrator has said no prior period
 * exists), `unlinked` (nobody has linked one yet), and `linked` with a null period (the
 * link points at a row outside what this company may read). A renderer that printed one
 * sentence for all three would state a fact it does not have.
 */
export interface ReportBenchmarkComparison {
  benchmarkId: string
  name: string
  category: string
  type: string
  companyId: string | null
  priorPeriodStatus: string
  metrics: ReportBenchmarkMetric[]
  priorPeriod: ReportBenchmarkPriorPeriod | null
}

/** One AI insight as a report prints it — `ReportAIInsightItem` in ReportAIInsights.cs. */
export interface ReportAIInsight {
  id: string
  type: string
  category: string
  title: string
  description: string
  /**
   * An integer percentage, 0-100. This is the field #152 was about: the legacy app had
   * two `AIInsight` models, one 0-100 and one 0-1, and the report read the wrong one.
   * Nothing in a report may render a fractional confidence.
   */
  confidenceScore: number
  priority: string
  affectedSegments: string[]
  recommendedActions: string[]
  isAcknowledged: boolean
}

/** `ReportOutputDocument` in ReportAIInsights.cs. */
export interface ReportDocument {
  /**
   * The generator's own note that the document is not yet the whole report — it names
   * the sections that do not exist yet.
   *
   * It is **server-authored English** and is deliberately not rendered verbatim
   * anywhere: printing it would put an untranslated developer sentence in front of a
   * Spanish-speaking reader. What it is good for is the boolean question "is this
   * document complete", which a client can ask without reading the prose.
   */
  generationNote: string
  surveys: ReportSurveySection[]
  aiInsights: ReportAIInsight[]
  benchmarks: ReportBenchmarkComparison[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** A finite number, or `fallback`. `NaN` and `Infinity` are not counts. */
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * A boolean, defaulting to the value the CALLER says is safe rather than to `false`.
 *
 * Every boolean this module reads except `isAcknowledged` is a suppression flag, and
 * the safe default for "should this be withheld" is *yes*. A malformed section that
 * defaulted `isSuppressed` to `false` would publish per-dimension scores the server may
 * have withheld — the one failure this document shape exists to prevent.
 */
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringArray(value: unknown): string[] {
  return array(value).filter((item): item is string => typeof item === 'string')
}

function participationOf(value: unknown): SurveyResultsSummary {
  const raw = isRecord(value) ? value : {}
  return {
    invitedCount: nullableNum(raw.invitedCount),
    responseCount: num(raw.responseCount),
    completedCount: num(raw.completedCount),
    partialCount: num(raw.partialCount),
    participationRate: nullableNum(raw.participationRate),
    completionRate: num(raw.completionRate),
    averageCompletionSeconds: nullableNum(raw.averageCompletionSeconds),
    firstResponseAt: nullableStr(raw.firstResponseAt),
    lastResponseAt: nullableStr(raw.lastResponseAt),
    byLanguage: array(raw.byLanguage)
      .filter(isRecord)
      .map((row) => ({ language: str(row.language), count: num(row.count) })),
  }
}

function dimensionOf(value: unknown): ReportDimensionScore {
  const raw = isRecord(value) ? value : {}
  return {
    dimension: str(raw.dimension),
    questionCount: num(raw.questionCount),
    answeredCount: num(raw.answeredCount),
    averageScore: nullableNum(raw.averageScore),
  }
}

function departmentOf(value: unknown): ReportDepartmentParticipation {
  const raw = isRecord(value) ? value : {}
  const isSuppressed = bool(raw.isSuppressed, true)
  return {
    departmentId: str(raw.departmentId),
    name: nullableStr(raw.name),
    // Zeroed rather than carried when the row says it is suppressed. The server already
    // does this; doing it again here means a row that arrives suppressed with a
    // non-zero count — a generator bug, a hand-edited column — cannot leak the count
    // through this client.
    respondentCount: isSuppressed ? 0 : num(raw.respondentCount),
    participationRate: isSuppressed ? null : nullableNum(raw.participationRate),
    isSuppressed,
  }
}

function bucketOf(value: unknown): SurveyDistributionBucket {
  const raw = isRecord(value) ? value : {}
  return {
    value: str(raw.value),
    label: nullableStr(raw.label),
    count: num(raw.count),
    percentage: num(raw.percentage),
    averageRank: nullableNum(raw.averageRank),
  }
}

/**
 * One entry of a word cloud: a word, its language, and two counts. Nothing else.
 *
 * ## The whitespace guard is the frequency-only rule, enforced rather than trusted
 *
 * This platform never returns verbatim open-text content — "Voices" was closed
 * permanently on that basis — and a word cloud is the one open-text surface that
 * survived, because a *frequency map* names no one the way a sentence does.
 *
 * The server tokenises on `[' ', '\t', '\n', '\r', '.', ',', '!', '?', ';', ':', '(',
 * ')', '"']` (`SurveyAggregation.WordSeparators`), so a legitimate entry can never
 * contain whitespace or sentence punctuation. An entry that does is therefore not a
 * word: it is a phrase, and the only ways one arrives are a generator regression, a
 * hand-edited column, or a document from somewhere this client did not expect. Each of
 * those is exactly the case where a renderer must not print it.
 *
 * So the entry is dropped here, at the parser, and `wordsOf` counts what it dropped
 * onto `suppressedWordCount` — because a reader must be told something was withheld
 * rather than shown a shorter list that looks complete. Dropping is deliberately not
 * "trim it into a word": splitting a phrase back into tokens would be this client
 * inventing frequencies the aggregation never computed and never floored.
 */
const NOT_A_SINGLE_WORD = /[\s.,!?;:()"]/

function wordOf(value: unknown): SurveyWordFrequency | null {
  const raw = isRecord(value) ? value : {}
  const word = str(raw.word)
  if (word === '' || NOT_A_SINGLE_WORD.test(word)) return null
  return {
    language: str(raw.language),
    word,
    count: num(raw.count),
    responseCount: num(raw.responseCount),
  }
}

/**
 * A question's cloud, and the withheld total that goes with it.
 *
 * The two are read together because they are one statement: "these words, and this many
 * you cannot see". A list shortened without its counter says "these words, and that is
 * all there was", which is a claim about other people's answers that this client is in
 * no position to make.
 */
function wordsOf(raw: Record<string, unknown>): {
  words: SurveyWordFrequency[]
  suppressedWordCount: number
} {
  const entries = array(raw.words)
  const words = entries.map(wordOf).filter((word): word is SurveyWordFrequency => word !== null)
  return {
    words,
    suppressedWordCount: num(raw.suppressedWordCount) + (entries.length - words.length),
  }
}

/**
 * One question's results — `SurveyQuestionResult`, carried by the report verbatim.
 *
 * Read field by field rather than cast, for the reason the module header gives, and
 * with one addition of its own: the fields listed here are the *only* ones that survive
 * parsing, so a document that grew a verbatim-answers field — from a future generator,
 * a hand-edited column, a different product's export pointed at this page — cannot
 * carry it into a renderer. The open-text guarantee is a property of what this function
 * copies, not of what the renderer chooses to print.
 */
function questionOf(value: unknown): SurveyQuestionResult {
  const raw = isRecord(value) ? value : {}
  const { words, suppressedWordCount } = wordsOf(raw)
  return {
    questionId: str(raw.questionId),
    order: num(raw.order),
    type: str(raw.type),
    text: nullableStr(raw.text),
    category: nullableStr(raw.category),
    answeredCount: num(raw.answeredCount),
    distribution: array(raw.distribution).map(bucketOf),
    average: nullableNum(raw.average),
    median: nullableNum(raw.median),
    scaleMin: nullableNum(raw.scaleMin),
    scaleMax: nullableNum(raw.scaleMax),
    scaleLabelMin: nullableStr(raw.scaleLabelMin),
    scaleLabelMax: nullableStr(raw.scaleLabelMax),
    words,
    suppressedWordCount,
  }
}

function segmentScoreOf(value: unknown): ReportSegmentDimensionScore {
  const raw = isRecord(value) ? value : {}
  return {
    dimension: str(raw.dimension),
    averageScore: nullableNum(raw.averageScore),
  }
}

/**
 * One demographic group, with the same refusal `departmentOf` makes.
 *
 * A group that arrives suppressed and still carrying a count or a score is a generator
 * bug or a hand-edited column, and it is precisely the row a client must not pass on —
 * so the count is zeroed and the scores dropped here as well as there.
 */
function segmentOf(value: unknown): ReportSegmentParticipation {
  const raw = isRecord(value) ? value : {}
  const isSuppressed = bool(raw.isSuppressed, true)
  return {
    key: str(raw.key),
    label: nullableStr(raw.label),
    respondentCount: isSuppressed ? 0 : num(raw.respondentCount),
    isSuppressed,
    dimensions: isSuppressed ? [] : array(raw.dimensions).map(segmentScoreOf),
  }
}

function demographicOf(value: unknown): ReportDemographicBreakdown {
  const raw = isRecord(value) ? value : {}
  return {
    dimension: str(raw.dimension),
    segments: array(raw.segments).map(segmentOf),
    suppressedSegmentCount: num(raw.suppressedSegmentCount),
    suppressedRespondentCount: num(raw.suppressedRespondentCount),
    unsegmentedRespondentCount: num(raw.unsegmentedRespondentCount),
  }
}

function benchmarkMetricOf(value: unknown): ReportBenchmarkMetric {
  const raw = isRecord(value) ? value : {}
  return {
    id: str(raw.id),
    metricName: str(raw.metricName),
    value: num(raw.value),
    unit: str(raw.unit),
    percentile: nullableNum(raw.percentile),
    sampleSize: nullableNum(raw.sampleSize),
  }
}

function benchmarkChangeOf(value: unknown): ReportBenchmarkMetricChange {
  const raw = isRecord(value) ? value : {}
  return {
    metricName: str(raw.metricName),
    value: nullableNum(raw.value),
    unit: nullableStr(raw.unit),
    priorValue: nullableNum(raw.priorValue),
    priorUnit: nullableStr(raw.priorUnit),
    // Carried, never recomputed from the two values above. The server withholds this
    // when the units differ, and a client that filled the gap with its own subtraction
    // would print exactly the confidently wrong number #89 exists to avoid.
    delta: nullableNum(raw.delta),
    changeRatio: nullableNum(raw.changeRatio),
  }
}

function priorPeriodOf(value: unknown): ReportBenchmarkPriorPeriod | null {
  if (!isRecord(value)) return null
  return {
    id: str(value.id),
    name: str(value.name),
    metrics: array(value.metrics).map(benchmarkChangeOf),
  }
}

function benchmarkOf(value: unknown): ReportBenchmarkComparison {
  const raw = isRecord(value) ? value : {}
  return {
    benchmarkId: str(raw.benchmarkId),
    name: str(raw.name),
    category: str(raw.category),
    type: str(raw.type),
    companyId: nullableStr(raw.companyId),
    priorPeriodStatus: str(raw.priorPeriodStatus),
    metrics: array(raw.metrics).map(benchmarkMetricOf),
    priorPeriod: priorPeriodOf(raw.priorPeriod),
  }
}

function sectionOf(value: unknown): ReportSurveySection {
  const raw = isRecord(value) ? value : {}
  const isSuppressed = bool(raw.isSuppressed, true)
  return {
    surveyId: str(raw.surveyId),
    title: nullableStr(raw.title),
    status: str(raw.status),
    resolvedLocale: str(raw.resolvedLocale),
    participation: participationOf(raw.participation),
    // Dropped outright for a suppressed section, mirroring the server's own "Questions,
    // Dimensions and Demographics are empty when IsSuppressed is true". Two
    // implementations of one rule is a smell, but the alternative is a renderer that
    // trusts a list the server promises is empty — and these lists are the withheld
    // data itself, per-question distributions and word clouds included.
    questions: isSuppressed ? [] : array(raw.questions).map(questionOf),
    dimensions: isSuppressed ? [] : array(raw.dimensions).map(dimensionOf),
    departments: array(raw.departments).map(departmentOf),
    suppressedDepartmentCount: num(raw.suppressedDepartmentCount),
    suppressedRespondentCount: num(raw.suppressedRespondentCount),
    unsegmentedRespondentCount: num(raw.unsegmentedRespondentCount),
    demographics: isSuppressed ? [] : array(raw.demographics).map(demographicOf),
    isSuppressed,
    suppressionReason: nullableStr(raw.suppressionReason),
    minimumGroupSize: num(raw.minimumGroupSize),
  }
}

function insightOf(value: unknown): ReportAIInsight {
  const raw = isRecord(value) ? value : {}
  return {
    id: str(raw.id),
    type: str(raw.type),
    category: str(raw.category),
    title: str(raw.title),
    description: str(raw.description),
    confidenceScore: num(raw.confidenceScore),
    priority: str(raw.priority),
    affectedSegments: stringArray(raw.affectedSegments),
    recommendedActions: stringArray(raw.recommendedActions),
    isAcknowledged: bool(raw.isAcknowledged, false),
  }
}

/**
 * Parses `reports.report_output` into a document, or returns `null`.
 *
 * `null` for: a null/absent column, text that is not JSON, and JSON that is not an
 * object (the placeholder this column held before #88 was the JSON string
 * `"Report generation is stubbed…"`, which parses fine and is not a document — the
 * exact shape a cast would have turned into a crash).
 *
 * Anything that IS an object is read field by field with the defaults above, so a
 * document missing `surveys` renders as a report with no survey sections rather than
 * throwing.
 */
export function parseReportDocument(raw: string | null | undefined): ReportDocument | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  return {
    generationNote: str(parsed.generationNote),
    surveys: array(parsed.surveys).map(sectionOf),
    aiInsights: array(parsed.aiInsights).map(insightOf),
    benchmarks: array(parsed.benchmarks).map(benchmarkOf),
  }
}
