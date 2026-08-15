import { useState } from 'react'
import { LanguageSwitcher, useTranslation } from '../../../i18n'
import {
  BarChart,
  ClimateMap,
  Counter,
  HeatMap,
  KPIDisplay,
  KpiTile,
  ProtectedCell,
  LineChart,
  ParticipationTracker,
  PieChart,
  RealTimeChartContainer,
  RecommendationCard,
  SentimentVisualization,
  WordCloud,
  type ChartDatum,
  type ChartSeries,
  type ClimateMapDimension,
  type ClimateMapRow,
  type HeatMapCell,
  type Kpi,
  type PieSlice,
  type RecommendedAction,
  type WordFrequency,
} from '../../../components/charts'
import { SENTIMENT_STUB } from '../../../components/charts/sentimentStub'
import { PageTopBar } from '../../../components/layout'
import {
  Button,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type ChipTone,
} from '../../../components/ui'
import { readAdminThemeMode, resolveAdminTheme, setAdminThemeMode } from '../../../theme/adminTheme'

/**
 * Every chart in #79, on one page, with sample data.
 *
 * ## Why this page exists
 *
 * #79's acceptance criteria require the components to be rendered in a real page,
 * and that is not box-ticking: it is the only way to check the things happy-dom
 * cannot see. `ResponsiveContainer` renders **zero** `<svg>` under happy-dom
 * because `getBoundingClientRect` returns 0, recharts bars resolve to empty
 * `<g>` elements with no observable fill, and pie sectors do not exist at all —
 * all measured, and written up in `components/charts/README.md`. So the entire
 * responsive path, every fill, every radius, the 2px surface gap between stacked
 * segments and the whole of dark mode are invisible to the test suite by
 * construction. They are visible here.
 *
 * It doubles as the reference for anyone building a Batch 3 analytics page: what
 * each component is for, what it looks like with real proportions, and which form
 * suits which question.
 *
 * ## Why it is a route rather than a Storybook
 *
 * Storybook is a second build, a second dependency tree and a second set of
 * decisions about how components get their theme and their translations. This page
 * runs in the actual app, through the actual router, stylesheet, token layer and
 * `TranslationProvider` — so it exercises the same code path a customer-facing page
 * will, which is precisely what needed verifying.
 *
 * ## No data source
 *
 * Everything below is hardcoded sample data, and the polling demo resolves from a
 * local counter rather than the network, so the page makes no API calls and can
 * show nothing it should not. The sentiment figures come from `sentimentStub` and
 * are flagged on screen as placeholders, because sentiment is blocked on #67.
 *
 * ## Development builds only
 *
 * The route is gated on `import.meta.env.DEV` in `app/router.tsx`, and the dynamic
 * `import()` that reaches this file sits *inside* that branch — so Rollup never
 * reaches this module in a production build and emits no chunk for it. That is the
 * part worth being careful about: gating only the route entry would hide the URL
 * while still shipping the code, because a static import at the top of the router
 * keeps the module in the graph. `app/router.test.ts` asserts all of it, including
 * that nothing in the production graph statically imports this page.
 *
 * One residue: the ~46 `charts.gallery*` translation keys live in the shared
 * catalogues, which cannot be tree-shaken per key, so about 1.8 kB gzipped of
 * dev-only copy does ship. Noted in `components/charts/README.md`.
 */
export default function ChartGalleryPage() {
  const { t } = useTranslation()
  const [theme, setTheme] = useState(() => resolveAdminTheme(readAdminThemeMode()))
  const [selectedWord, setSelectedWord] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  function toggleTheme() {
    // Dark mode is where a hardcoded colour or an inverted ramp shows up, and no
    // test can see it. Flipping it here is the actual check.
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(setAdminThemeMode(next))
  }

  return (
    <main style={{ maxWidth: 'var(--admin-size-content-max)', margin: '0 auto', padding: '2rem' }}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1>{t('charts.galleryTitle')}</h1>
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <button type="button" onClick={toggleTheme}>
            {theme === 'dark' ? t('charts.galleryLightMode') : t('charts.galleryDarkMode')}
          </button>
        </div>
      </header>

      <p className="text-fg-secondary">{t('charts.galleryBlurb')}</p>

      <Section title={t('charts.gallerySectionShell')}>
        {/* The page layout rule, rendered rather than described: header, then the
            readings, then the work. Look at the gap under the hairline (16px) and
            the pad above it (14px) — happy-dom computes neither. The description
            is the only thing capped; the table below runs the full width.

            `PageTopBar` renders an `<h1>`, and so does this gallery's own header,
            so this page has two. That is a property of showing a page header
            inside a catalogue of components, not of the component. */}
        {/* On a PANEL, not on the bare page. That is not decoration: the header's
            rule and the neutral chip's hairline are `--admin-border-light`
            (#eeeeee), and the gallery's own background is `--admin-bg-outer`
            (#f0f0f0) — two values apart, so in light mode both were invisible in
            the first render of this section and the geometry could not be
            checked at all. Every real screen puts this inside the shell's white
            card, so the panel is what has to be looked at. */}
        <div className="rounded-xl border border-line-default bg-surface-panel p-panel">
        <PageTopBar
          eyebrow={t('charts.galleryTopBarEyebrow')}
          title={t('charts.galleryTopBarTitle')}
          description={t('charts.galleryTopBarDescription')}
          actions={
            <>
              <Button size="sm">{t('charts.galleryTopBarExport')}</Button>
              <Button variant="primary" size="sm">
                {t('charts.galleryTopBarNewSurvey')}
              </Button>
            </>
          }
        />

        {/* Everything after the header, spaced by the container. `PageTopBar`
            brings its own 16px, so it stays outside this — stacking the two would
            silently double the gap the design specifies. */}
        <div className="flex flex-col gap-panel">
        {/* Not a bare `grid-cols-4`: rendered at 420px, four fixed columns clipped
            "PARTICIPATION" mid-word and broke every tile's sub-line onto three
            lines. Two-up, then four-up. */}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile label={t('charts.galleryKpiClimateIndex')} value={72} previousValue={68} changeLabel={t('charts.gallerySinceQ1')} />
          <KpiTile label={t('charts.galleryKpiParticipation')} value={84} format={{ kind: 'percentage' }} sub={<span>{t('charts.galleryParticipationSub')}</span>} />
          <KpiTile label={t('charts.galleryKpiOpenPlans')} value={7} sub={<span>{t('charts.galleryPlansSub')}</span>} />
          {/* Up is BAD here -- this tile is the one that would render green in the
              legacy code, and it is in the gallery so the regression is visible. */}
          <KpiTile label={t('charts.galleryKpiAttrition')} value={12} previousValue={8} higherIsBetter={false} changeLabel={t('charts.gallerySinceQ1')} />
        </div>

        {/* All five tones at once, in both themes. Every one carries a word: the
            hue is a second channel, never the only one (WCAG 1.4.1). */}
        <p className="text-fg-secondary">{t('charts.galleryChipsBeside')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="good" label={t('charts.galleryChipGood')} />
          <Chip tone="warning" label={t('charts.galleryChipWarning')} />
          <Chip tone="critical" label={t('charts.galleryChipCritical')} />
          <Chip tone="accent" label={t('charts.galleryChipAccent')} />
          <Chip tone="neutral" label={t('charts.galleryChipNeutral')} />
        </div>

        {/* The case the 20px height exists for. A chip that is a different height
            per tone, or taller than the row's line box, is only visible here. */}
        <p className="text-fg-secondary">{t('charts.galleryChipsInRow')}</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('charts.galleryChipsColumnSurvey')}</TableHead>
              <TableHead>{t('charts.galleryChipsColumnStatus')}</TableHead>
              <TableHead>{t('charts.galleryChipsColumnResponses')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CHIP_ROWS.map((row) => (
              <TableRow key={row.tone}>
                <TableCell>{t(row.nameKey)}</TableCell>
                <TableCell>
                  <Chip tone={row.tone} label={t(row.labelKey)} />
                </TableCell>
                {/* The typographic rule: every reading is mono with tabular
                    figures, prose stays in the sans face. */}
                <TableCell className="font-mono tabular-nums">{row.responses}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        </div>
      </Section>

      <Section title={t('charts.gallerySectionKpis')}>
        <KPIDisplay kpis={KPIS} columns={3} />
      </Section>

      <Section title={t('charts.gallerySectionCounter')}>
        <div className="flex flex-wrap gap-8">
          <Counter value={1284} label={t('charts.galleryResponsesLabel')} />
          <Counter value={78.4} suffix="%" label={t('charts.galleryEngagementLabel')} />
        </div>
      </Section>

      <Section title={t('charts.gallerySectionBars')}>
        {/* No `width`: this is the responsive path, which renders nothing at all
            under happy-dom and is therefore only ever exercised here. */}
        <BarChart data={DIMENSIONS} series={QUARTERS} title={t('charts.galleryGroupedBars')} />
        <BarChart
          data={DIMENSIONS}
          series={QUARTERS}
          stacked
          title={t('charts.galleryStackedBars')}
        />
      </Section>

      <Section title={t('charts.gallerySectionLines')}>
        <LineChart data={TREND} series={TREND_SERIES} title={t('charts.galleryTrend')} />
      </Section>

      <Section title={t('charts.gallerySectionComposition')}>
        <div className="grid gap-8 md:grid-cols-2">
          <PieChart data={ENGAGEMENT} title={t('charts.galleryPie')} />
          <PieChart data={ENGAGEMENT} donut title={t('charts.galleryDonut')} />
        </div>
        {/* Nine slices against a six-colour palette: the fold into "Other" is the
            behaviour to look at here. */}
        <PieChart data={MANY_SLICES} title={t('charts.galleryPieFolded')} />
      </Section>

      <Section title={t('charts.gallerySectionHeatMap')}>
        {/* Values are on by default since #208. Toggle the theme above with this
            rendered: the ink flips with the fill, so every number stays legible
            at both ends of the ramp in both themes. */}
        <HeatMap data={HEATMAP} title={t('charts.galleryHeatMap')} />
        <HeatMap data={HEATMAP} showValues={false} title={t('charts.galleryHeatMapValues')} />
      </Section>

      <Section title={t('charts.gallerySectionUi0')}>
        {/* Rendered here rather than trusted to a green suite: happy-dom does no
            layout, which is how HeatMap's `w-auto` defect survived its tests.
            Switch the theme above with this on screen -- the diverging ink flips
            with the fill, and the protected hatch has to stay legible in both.
            The KPI row moved up into the section above, where it demonstrates the
            page layout rule it belongs to rather than being repeated here. */}
        <ClimateMap
          dimensions={CLIMATE_DIMENSIONS}
          rows={CLIMATE_ROWS}
          target={70}
          title={t('charts.galleryClimateMap')}
        />

        <div className="flex items-center gap-2 text-xs text-fg-secondary">
          <span>{t('charts.galleryProtectedBeside')}</span>
          <ProtectedCell responses={12} description="Operations, workload">
            <span className="font-mono tabular-nums">61</span>
          </ProtectedCell>
          <ProtectedCell responses={4} description="Finance, workload" suppressedClassName="h-7 w-12">
            <span className="font-mono tabular-nums">61</span>
          </ProtectedCell>
        </div>
      </Section>

      <Section title={t('charts.gallerySectionWords')}>
        <WordCloud data={WORDS} title={t('charts.galleryWords')} />
        <WordCloud data={WORDS} colorBy="category" title={t('charts.galleryWordsByCategory')} />
        <WordCloud
          data={SENTIMENT_WORDS}
          colorBy="sentiment"
          title={t('charts.galleryWordsBySentiment')}
          onWordSelect={(word) => setSelectedWord(word.text)}
        />
        {selectedWord ? (
          <p className="text-fg-secondary">
            {t('charts.gallerySelectedWord', { word: selectedWord })}
          </p>
        ) : null}
      </Section>

      <Section title={t('charts.gallerySectionParticipation')}>
        <ParticipationTracker current={412} target={480} minutesRemaining={150} />
        <ParticipationTracker current={92} target={480} minutesRemaining={45} />
        <ParticipationTracker current={190} target={480} />
      </Section>

      <Section title={t('charts.gallerySectionSentiment')}>
        {/* Placeholder figures, flagged on screen -- sentiment is blocked on #67. */}
        <SentimentVisualization data={SENTIMENT_STUB} isPlaceholder />
      </Section>

      <Section title={t('charts.gallerySectionRealTime')}>
        <RealTimeChartContainer
          title={t('charts.galleryLiveResponses')}
          intervalMs={3000}
          fetch={nextLiveSample}
        >
          {(sample) => <ParticipationTracker current={sample} target={480} />}
        </RealTimeChartContainer>
      </Section>

      <Section title={t('charts.gallerySectionRecommendations')}>
        <RecommendationCard
          title={t('charts.gallerySampleRecommendationTitle')}
          description={t('charts.gallerySampleRecommendationBody')}
          kind="action"
          priority="high"
          confidence={0.72}
          category={t('charts.gallerySampleCategory')}
          affectedAreas={[t('charts.gallerySampleAreaSupport'), t('charts.gallerySampleAreaOnboarding')]}
          actions={SAMPLE_ACTIONS(t)}
          metrics={{ current: 62, target: 80, format: { kind: 'percentage' } }}
          isAccepted={accepted}
          onAccept={() => setAccepted(true)}
          onDismiss={() => setAccepted(false)}
          onViewDetails={() => undefined}
        />
        <RecommendationCard
          title={t('charts.gallerySampleAlertTitle')}
          description={t('charts.gallerySampleAlertBody')}
          kind="alert"
          priority="critical"
          confidence={0.91}
          category={t('charts.gallerySampleCategory')}
        />
      </Section>

      <Section title={t('charts.gallerySectionStates')}>
        <div className="grid gap-8 md:grid-cols-2">
          <BarChart data={[]} series={QUARTERS} title={t('charts.galleryEmpty')} />
          <BarChart data={DIMENSIONS} series={QUARTERS} isLoading title={t('charts.galleryLoading')} />
          {/* Every series value null: rows exist, but there is nothing to plot. */}
          <BarChart data={ALL_NULL} series={QUARTERS} title={t('charts.galleryAllNull')} />
          <LineChart data={WITH_GAP} series={TREND_SERIES} title={t('charts.galleryGap')} />
        </div>
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2>{title}</h2>
      {children}
      <hr />
    </section>
  )
}

/* ---------------------------------------------------------------------------
 * Sample data. Hardcoded on purpose: this page must not depend on a backend.
 * ------------------------------------------------------------------------- */

/**
 * One row per chip tone, so a row of chips can be seen inside a real table.
 * `tone` is `ChipTone`, not a string, so a typo is a type error rather than an
 * unstyled chip.
 */
const CHIP_ROWS: { tone: ChipTone; nameKey: string; labelKey: string; responses: number }[] = [
  { tone: 'good', nameKey: 'charts.galleryKpiClimateIndex', labelKey: 'charts.galleryChipGood', responses: 412 },
  { tone: 'warning', nameKey: 'charts.galleryKpiParticipation', labelKey: 'charts.galleryChipWarning', responses: 96 },
  { tone: 'critical', nameKey: 'charts.galleryKpiOpenPlans', labelKey: 'charts.galleryChipCritical', responses: 7 },
  { tone: 'accent', nameKey: 'charts.galleryTopBarTitle', labelKey: 'charts.galleryChipAccent', responses: 1284 },
  { tone: 'neutral', nameKey: 'charts.galleryKpiAttrition', labelKey: 'charts.galleryChipNeutral', responses: 0 },
]

const CLIMATE_DIMENSIONS: ClimateMapDimension[] = [
  { key: 'safety', label: 'Safety', fullLabel: 'Psychological safety' },
  { key: 'workload', label: 'Workload' },
  { key: 'trust', label: 'Trust', fullLabel: 'Leadership trust' },
  { key: 'recognition', label: 'Recogn.', fullLabel: 'Recognition' },
  { key: 'growth', label: 'Growth' },
  { key: 'belonging', label: 'Belong.', fullLabel: 'Belonging' },
]

// Every band is represented on purpose, including a row under the floor: the
// point of rendering this is to see all five steps and the hatch at once.
const CLIMATE_ROWS: ClimateMapRow[] = [
  { id: 'ops', label: 'Operations', responses: 48, scores: [74, 61, 72, 68, 71, 76] },
  { id: 'support', label: 'Support', responses: 23, scores: [58, 52, 63, 60, 66, 69] },
  { id: 'sales', label: 'Sales', responses: 31, scores: [77, 70, 74, 74, 72, 78] },
  { id: 'eng', label: 'Engineering', responses: 57, scores: [81, 66, 79, 73, 84, 80] },
  { id: 'people', label: 'People', responses: 12, scores: [79, 68, 77, 75, 78, 82] },
  { id: 'finance', label: 'Finance', responses: 4, scores: [79, 81, 77, 80, 76, 83] },
]

const QUARTERS: ChartSeries[] = [
  { key: 'q1', name: 'Q1' },
  { key: 'q2', name: 'Q2' },
  { key: 'q3', name: 'Q3' },
]

const DIMENSIONS: ChartDatum[] = [
  { label: 'Leadership', values: { q1: 74, q2: 79, q3: 85 } },
  { label: 'Communication', values: { q1: 65, q2: 68, q3: 72 } },
  { label: 'Work-life balance', values: { q1: 71, q2: 69, q3: 68 } },
  { label: 'Development', values: { q1: 60, q2: 70, q3: 79 } },
  { label: 'Recognition', values: { q1: 55, q2: 61, q3: 74 } },
]

const ALL_NULL: ChartDatum[] = [
  { label: 'Leadership', values: { q1: null, q2: null, q3: null } },
  { label: 'Communication', values: { q1: null, q2: null, q3: null } },
]

const TREND_SERIES: ChartSeries[] = [{ key: 'score', name: 'Climate score' }]

const TREND: ChartDatum[] = [
  { label: 'Jan', values: { score: 65 } },
  { label: 'Feb', values: { score: 68 } },
  { label: 'Mar', values: { score: 72 } },
  { label: 'Apr', values: { score: 70 } },
  { label: 'May', values: { score: 75 } },
  { label: 'Jun', values: { score: 78 } },
]

/** `connectNulls={false}` means March reads as a gap, not as an interpolated line. */
const WITH_GAP: ChartDatum[] = [
  { label: 'Jan', values: { score: 65 } },
  { label: 'Feb', values: { score: 68 } },
  { label: 'Mar', values: { score: null } },
  { label: 'Apr', values: { score: 70 } },
  { label: 'May', values: { score: 75 } },
]

const ENGAGEMENT: PieSlice[] = [
  { key: 'engaged', name: 'Engaged', value: 45 },
  { key: 'neutral', name: 'Neutral', value: 35 },
  { key: 'disengaged', name: 'Disengaged', value: 20 },
]

const MANY_SLICES: PieSlice[] = [
  { key: 'eng', name: 'Engineering', value: 40 },
  { key: 'sales', name: 'Sales', value: 32 },
  { key: 'support', name: 'Support', value: 28 },
  { key: 'mkt', name: 'Marketing', value: 20 },
  { key: 'fin', name: 'Finance', value: 14 },
  { key: 'hr', name: 'People', value: 9 },
  { key: 'legal', name: 'Legal', value: 5 },
  { key: 'ops', name: 'Operations', value: 4 },
  { key: 'it', name: 'IT', value: 3 },
]

const HEATMAP: HeatMapCell[] = [
  { x: 'Q1', y: 'Engineering', value: 85 },
  { x: 'Q2', y: 'Engineering', value: 88 },
  { x: 'Q3', y: 'Engineering', value: 82 },
  { x: 'Q1', y: 'Sales', value: 72 },
  { x: 'Q2', y: 'Sales', value: 75 },
  { x: 'Q3', y: 'Sales', value: 78 },
  { x: 'Q1', y: 'Support', value: 58 },
  { x: 'Q2', y: 'Support', value: 61 },
  // Q3 for Support is deliberately absent: an uncoloured gap, not a zero.
  { x: 'Q1', y: 'Marketing', value: 68 },
  { x: 'Q2', y: 'Marketing', value: 71 },
  { x: 'Q3', y: 'Marketing', value: 74 },
]

const WORDS: WordFrequency[] = [
  { text: 'Innovation', value: 95, category: 'Culture' },
  { text: 'Collaboration', value: 87, category: 'Teamwork' },
  { text: 'Growth', value: 82, category: 'Development' },
  { text: 'Flexibility', value: 78, category: 'Work-life' },
  { text: 'Recognition', value: 75, category: 'Rewards' },
  { text: 'Communication', value: 73, category: 'Leadership' },
  { text: 'Trust', value: 70, category: 'Culture' },
  { text: 'Support', value: 68, category: 'Leadership' },
  { text: 'Balance', value: 65, category: 'Work-life' },
  { text: 'Learning', value: 62, category: 'Development' },
  { text: 'Autonomy', value: 48, category: 'Culture' },
  { text: 'Workload', value: 41, category: 'Work-life' },
  { text: 'Clarity', value: 33, category: 'Leadership' },
  { text: 'Tooling', value: 21, category: 'Enablement' },
  { text: 'Onboarding', value: 14, category: 'Enablement' },
]

const SENTIMENT_WORDS: WordFrequency[] = [
  { text: 'Supportive', value: 88, sentiment: 0.8 },
  { text: 'Flexible', value: 74, sentiment: 0.6 },
  { text: 'Process', value: 66, sentiment: 0.01 },
  { text: 'Meetings', value: 52, sentiment: -0.2 },
  { text: 'Workload', value: 44, sentiment: -0.7 },
  { text: 'Burnout', value: 19, sentiment: -0.9 },
]

const KPIS: Kpi[] = [
  {
    id: 'engagement',
    label: 'Engagement score',
    value: 78,
    target: 85,
    previousValue: 74,
    format: { kind: 'percentage' },
  },
  {
    id: 'participation',
    label: 'Survey participation',
    value: 412,
    target: 480,
    previousValue: 389,
  },
  {
    // higherIsBetter: false -- a rise here must not paint green.
    id: 'attrition',
    label: 'Voluntary attrition',
    value: 11.4,
    previousValue: 9.2,
    higherIsBetter: false,
    format: { kind: 'percentage' },
  },
  {
    id: 'time-to-close',
    label: 'Action plan cycle time',
    value: 23,
    previousValue: 31,
    higherIsBetter: false,
    format: { kind: 'duration', unit: 'day' },
  },
  {
    // previousValue 0 -- the "Infinity%" case.
    id: 'new-metric',
    label: 'Microclimates launched',
    value: 6,
    previousValue: 0,
  },
  {
    // target 0 -- the falsy-target case.
    id: 'incidents',
    label: 'Escalated incidents',
    value: 2,
    target: 0,
    previousValue: 5,
    higherIsBetter: false,
  },
]

const SAMPLE_ACTIONS = (t: (key: string) => string): RecommendedAction[] => [
  {
    id: 'listen',
    title: t('charts.gallerySampleActionOneTitle'),
    description: t('charts.gallerySampleActionOneBody'),
    effort: 'low',
    impact: 'high',
    timeline: '2 weeks',
    assignee: 'Ana',
  },
  {
    id: 'workload',
    title: t('charts.gallerySampleActionTwoTitle'),
    description: t('charts.gallerySampleActionTwoBody'),
    effort: 'high',
    impact: 'high',
    timeline: '1 quarter',
  },
]

/**
 * Stands in for a live endpoint. Climbs towards the target and stops, so the
 * polling indicator and the band changes are both observable without a backend.
 */
let liveSample = 96
function nextLiveSample(): Promise<number> {
  liveSample = Math.min(480, liveSample + 38)
  return Promise.resolve(liveSample)
}
