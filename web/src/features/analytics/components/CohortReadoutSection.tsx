import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { getBenchmark, type Benchmark, type BenchmarkListItem } from '../api/benchmarks'
import { listSurveys } from '../../surveys/api/surveys'
import { getSurveyAnalytics } from '../../surveys/api/surveyResults'
import { buildCohortReadout, type CohortReadout } from '../cohortReadout'
import CohortDimensionBars from './CohortDimensionBars'
import { KpiTile } from '../../../components/charts'
import { KpiRow, SectionHeading } from '../../dashboard/components/dashboardGrammar'
import { EmptyState, SkeletonText } from '../../../components/ui'
import { useTranslation } from '../../../i18n'

/**
 * The approved Benchmarks screen: how this company reads against its industry cohort.
 *
 * ## Why this composes three existing reads instead of a new endpoint
 *
 * Every figure the design asks for already has a home. The company's own scores are the
 * per-dimension averages `GET /surveys/{id}/analytics` already computes — the same
 * aggregation the results screen renders — and the cohort's medians, percentile and sample
 * size are `BenchmarkMetric.Value`, `.Percentile` and `.SampleSize`, which the entity has
 * carried all along. Adding a server-side read-out would have duplicated the aggregation
 * for no new capability.
 *
 * ## Which survey "your index" is measured on
 *
 * The company's **most recently closed** survey. The design's own copy implies a period
 * ("▲ 4 since Q1"), and a quarter-scoped company-wide index is a larger piece of work that
 * is deliberately not in scope. Naming the survey under the tile is what keeps this honest:
 * the reader is told exactly which measurement they are looking at rather than being left
 * to assume it covers everything.
 *
 * ## Why the cohort lives in the URL
 *
 * `?cohort=<id>`. The old screen kept its selection in `useState`, so the comparison bars
 * existed only after two clicks and no link, screenshot harness or bug report could ever
 * point at them. A read-out nobody can address is a read-out nobody can review.
 */

/** Percentile bands, as the design labels them. */
function bandKey(percentile: number): string {
  if (percentile >= 67) return 'benchmarks.bandUpper'
  if (percentile >= 34) return 'benchmarks.bandMiddle'
  return 'benchmarks.bandLower'
}

export interface CohortReadoutSectionProps {
  companyId: string
  /** The list the page already loaded, so this makes no second request for it. */
  benchmarks: BenchmarkListItem[]
  locale?: string
}

export default function CohortReadoutSection({
  companyId,
  benchmarks,
  locale,
}: CohortReadoutSectionProps) {
  const { t } = useTranslation()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [searchParams] = useSearchParams()

  const [cohort, setCohort] = useState<Benchmark | null>(null)
  const [readout, setReadout] = useState<CohortReadout | null>(null)
  const [surveyTitle, setSurveyTitle] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // The cohort named by the URL, else the first one the company can see. A benchmark id in
  // the query that this company cannot read simply falls back rather than erroring: the
  // parameter is a view preference, not an authorisation boundary.
  const requested = searchParams.get('cohort')
  const chosen = benchmarks.find((b) => b.id === requested) ?? benchmarks[0]
  const chosenId = chosen?.id

  useEffect(() => {
    if (!chosenId || !companyId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const [detail, surveys] = await Promise.all([
          getBenchmark(baseUrl, chosenId),
          listSurveys(baseUrl, { companyId, status: 'closed' }),
        ])
        // Most recently closed. `listSurveys` returns newest first for every other caller
        // on this screen's routes, but the order is sorted here rather than assumed.
        const latest = [...surveys].sort((a, b) =>
          String(b.endDate ?? '').localeCompare(String(a.endDate ?? '')),
        )[0]
        const analytics = latest ? await getSurveyAnalytics(baseUrl, latest.id) : null
        if (cancelled) return
        setCohort(detail)
        setSurveyTitle(latest?.title ?? null)
        setReadout(buildCohortReadout(analytics?.questions ?? [], detail.metrics ?? []))
      } catch {
        // A failed read-out leaves the section empty rather than taking down the page:
        // the benchmark records below it loaded fine and are still usable.
        if (!cancelled) {
          setCohort(null)
          setReadout(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [baseUrl, chosenId, companyId])

  if (loading) return <SkeletonText lines={4} />

  if (!cohort || !readout) {
    return (
      <EmptyState
        title={t('benchmarks.noCohortTitle')}
        description={t('benchmarks.noCohortDescription')}
      />
    )
  }

  const percentile = readout.percentile
  const dimensions = readout.dimensions.map((dimension) => ({
    key: dimension.key,
    // The author's own wording, exactly as `SurveyResultsPage` treats a dimension key:
    // these are not ours to translate.
    label: dimension.key,
    score: dimension.score,
    cohortMedian: dimension.cohortMedian,
  }))

  return (
    <div data-slot="cohort-readout">
      <KpiRow>
        <KpiTile
          label={t('benchmarks.yourIndex')}
          value={readout.yourIndex}
          locale={locale}
          sub={surveyTitle ?? undefined}
        />
        <KpiTile
          label={t('benchmarks.cohortMedianLabel')}
          value={readout.cohortMedian}
          locale={locale}
          sub={
            readout.cohortSize === null
              ? undefined
              : t('benchmarks.companiesCount', { count: readout.cohortSize })
          }
        />
        <KpiTile
          label={t('benchmarks.yourPercentile')}
          value={percentile}
          locale={locale}
          // The BAND only. The mock writes the reading as "68th", but `KpiTile` formats a
          // numeric value through the locale, so an ordinal cannot ride on it -- and
          // appending the bare suffix here printed "th · Upper third", which is not a
          // phrase. The label above already says what the number is.
          sub={percentile === null ? undefined : t(bandKey(percentile))}
        />
      </KpiRow>

      <SectionHeading>{t('benchmarks.byDimension')}</SectionHeading>
      <CohortDimensionBars dimensions={dimensions} locale={locale} />
    </div>
  )
}
