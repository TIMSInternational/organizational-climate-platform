import { useState } from 'react'
import { ChevronRight, Plus, Shield } from 'lucide-react'
import { useTranslation, type TranslateFn } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { KpiTile, formatMetric } from '../../../../components/charts'
import {
  Button,
  Checkbox,
  Chip,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  LoadingRegion,
  SkeletonText,
  Table,
} from '../../../../components/ui'
import { cn } from '../../../../lib/cn'
import { QUALITY_SCORE_FORMAT } from '../../benchmarkReadings'
import BenchmarkComparison from '../../components/BenchmarkComparison'
import BenchmarkDetailPanel from '../../components/BenchmarkDetailPanel'
import BenchmarkForm from '../../components/BenchmarkForm'
import BenchmarkPriorPeriodPanel from '../../components/BenchmarkPriorPeriodPanel'
import BenchmarkTrend from '../../components/BenchmarkTrend'
import CohortDimensionBars from '../../components/CohortDimensionBars'
import {
  bandUnit,
  belowSummary,
  benchmarkCategoryLabel,
  benchmarkTypeLabel,
  percentileSub,
  qualityReading,
  scopeKey,
} from './derive'
import type { BenchmarkReference, CohortReadoutModel, ReadoutState } from './model'
import { useBenchmarksModel } from './useBenchmarksModel'

// The canvas's `.label` head, as on every redesigned table.
const HEAD =
  'px-3 pt-2 pb-2 text-left text-2xs font-bold uppercase leading-normal tracking-label text-fg-label whitespace-nowrap border-b border-line-default'
const GAP_CELL = 'pl-0'

/**
 * `/analytics/benchmarks` — the redesigned Puntos de Referencia, which replaced
 * `pages/BenchmarksPage.tsx` on this route (ruled 10 Sep; the old page stays in the tree,
 * unrouted, as the wiring reference), drawn as the Benchmarks artboard.
 *
 * The bars are the hero: this company's index per dimension with the group's median as a
 * tick, and a word beside every bar ("bajo / en / sobre la mediana"). The three tiles
 * above say the same thing in one number each; the references the read-out is built from
 * are demoted under a disclosure, with their type and category as words and "sin calcular"
 * for a reference nobody has scored. Selecting rows still opens the comparison, the detail,
 * the prior period and the trend exactly as before.
 *
 * Roles, mirroring `BenchmarkEndpoints` through `benchmarkScope.ts`: both admin roles read
 * (`CanReadBenchmark`); "Nueva referencia" shows only for a caller who may create
 * (`newBenchmarkCompanyId`) and edit only where `CanWriteBenchmark` allows — a
 * company_admin never edits a global reference. Every other role is refused by the list
 * route, so they get a sentence and no request.
 */
export default function BenchmarksNextPage() {
  const { t, locale } = useTranslation()
  const state = useBenchmarksModel()
  const [creating, setCreating] = useState(false)
  const [referencesOpen, setReferencesOpen] = useState(true)
  const { single, details, chain } = state.selection

  return (
    <div>
      <PageTopBar
        // The cohort this company is read against: a property of the data, not the route.
        eyebrow={state.cohortName}
        title={t('navigation.benchmarks')}
        description={t('benchmarks.description')}
        actions={
          state.createCompanyId !== undefined ? (
            <Button type="button" variant="outline" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t('benchmarks.newBenchmark')}
            </Button>
          ) : undefined
        }
      />

      {state.status === 'forbidden' ? (
        <EmptyState fill title={t('benchmarks.next.noAccessTitle')} description={t('benchmarks.next.noAccessDescription')} />
      ) : state.status === 'error' ? (
        <ErrorState title={t('benchmarks.loadFailed')} description={state.error ?? undefined} />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' ? (
            <SkeletonText lines={6} />
          ) : state.references.length === 0 ? (
            <EmptyState fill title={t('benchmarks.noBenchmarks')} description={t('benchmarks.noBenchmarksDescription')} />
          ) : (
            <div className="flex flex-col gap-6">
              <ReadoutRegion readout={state.readout} t={t} locale={locale} />

              <Collapsible
                open={referencesOpen}
                onOpenChange={setReferencesOpen}
                data-slot="references"
                className="overflow-hidden rounded-xl border border-line-default bg-surface-card shadow-xs"
              >
                <div
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-3 bg-surface-outer px-4 py-3',
                    referencesOpen && 'border-b border-line-default',
                  )}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto gap-2.5 p-0 text-base font-semibold text-fg-secondary hover:not-disabled:bg-transparent"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className={cn('size-3.5 text-fg-label transition-transform', referencesOpen && 'rotate-90')}
                      />
                      {t('benchmarks.allBenchmarks')}
                      <span className="font-mono text-sm font-normal tabular-nums text-fg-label">
                        {state.references.length}
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  <p className="m-0 text-sm text-fg-label">{t('benchmarks.next.referencesHint')}</p>
                </div>
                <CollapsibleContent>
                  <div className="pt-2">
                    {/* The canvas's grid, `minmax(0,1fr) 90px 90px 140px 70px 150px` with 12px
                        between columns from xl; each fixed column carries the gap before it.
                        Below xl the columns tighten so the score stays on screen at 1024. */}
                    <Table className="min-w-180 table-fixed xl:min-w-200">
                      <colgroup>
                        <col />
                        <col className="w-20 xl:w-25.5" />
                        <col className="w-22 xl:w-25.5" />
                        <col className="w-36 xl:w-38" />
                        <col className="w-16 xl:w-20.5" />
                        <col className="w-32 xl:w-40.5" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-line-default">
                          <th className={HEAD}>{t('benchmarks.next.colReference')}</th>
                          <th className={cn(HEAD, GAP_CELL)}>{t('benchmarks.next.colType')}</th>
                          <th className={cn(HEAD, GAP_CELL)}>{t('benchmarks.category')}</th>
                          <th className={cn(HEAD, GAP_CELL)}>{t('benchmarks.scope')}</th>
                          <th className={cn(HEAD, GAP_CELL)}>{t('benchmarks.next.colActive')}</th>
                          <th className={cn(HEAD, GAP_CELL, 'text-right')}>{t('benchmarks.qualityScore')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.references.map((reference) => (
                          <ReferenceRow
                            key={reference.id}
                            reference={reference}
                            selected={state.selection.ids.includes(reference.id)}
                            onToggle={() => state.selection.toggle(reference.id)}
                            viewerCompanyId={state.viewerCompanyId}
                            t={t}
                            locale={locale}
                          />
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Comparison first, then the single-selection detail: the bars answer "where
                  does this sit", which is the question the page is for. */}
              {details.length > 1 && <BenchmarkComparison benchmarks={details} />}
              {single && (
                <BenchmarkDetailPanel
                  benchmark={single}
                  canWrite={state.canWrite(single.companyId)}
                  onUpdate={(input) => state.update(single.id, input)}
                  onAddMetric={(input) => state.addMetric(single.id, input)}
                />
              )}
              {single && (
                <BenchmarkPriorPeriodPanel
                  benchmark={single}
                  canWrite={state.canWrite(single.companyId)}
                  loadCandidates={state.loadCandidates}
                  onSet={(priorStatus, priorId) => state.setPriorPeriod(single.id, priorStatus, priorId)}
                />
              )}
              {single && chain.length > 1 && <BenchmarkTrend chain={chain} />}

              <p
                data-slot="privacy-note"
                className="m-0 flex items-start gap-2.5 rounded-lg bg-surface-icon-box px-3.5 py-3 text-sm text-fg-secondary"
              >
                <Shield aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{t('benchmarks.next.privacyNote')}</span>
              </p>
            </div>
          )}
        </LoadingRegion>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent closeLabel={t('common.close')} className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl font-normal">{t('benchmarks.newBenchmark')}</DialogTitle>
            <DialogDescription>
              {state.isSuperAdmin ? t('benchmarks.createsGlobalHint') : t('benchmarks.createsCompanyHint')}
            </DialogDescription>
          </DialogHeader>
          <BenchmarkForm
            variant="create"
            submitLabel={t('benchmarks.createBenchmark')}
            onSubmit={async (values) => {
              await state.create(values)
              setCreating(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ReadoutRegion({ readout, t, locale }: { readout: ReadoutState; t: TranslateFn; locale: string }) {
  switch (readout.kind) {
    case 'loading':
      return <SkeletonText lines={4} />
    case 'ready':
      return <Readout readout={readout.readout} t={t} locale={locale} />
    case 'pick-company':
      return (
        <EmptyState title={t('benchmarks.next.pickCompanyTitle')} description={t('benchmarks.next.pickCompanyDescription')} />
      )
    case 'no-survey':
      return <EmptyState title={t('benchmarks.next.noSurveyTitle')} description={t('benchmarks.next.noSurveyDescription')} />
    default:
      // No cohort, or the read-out could not be built: the same honest sentence the old
      // section gave, and the references below still work.
      return <EmptyState title={t('benchmarks.noCohortTitle')} description={t('benchmarks.noCohortDescription')} />
  }
}

function Readout({ readout, t, locale }: { readout: CohortReadoutModel; t: TranslateFn; locale: string }) {
  const below = belowSummary(readout.dimensions)
  const summary =
    below.count === 0 || below.widest === null
      ? t('benchmarks.next.belowSummaryNone')
      : below.count === 1
        ? t('benchmarks.next.belowSummaryOne', { dimension: below.widest.name })
        : t('benchmarks.next.belowSummary', { count: below.count, dimension: below.widest.name })
  const surveySub =
    readout.survey.responses === null
      ? readout.survey.title
      : t('benchmarks.next.surveySub', { survey: readout.survey.title, responses: readout.survey.responses })
  const cohortSub =
    readout.cohort.size === null
      ? readout.cohort.name
      : t('benchmarks.next.cohortSub', { count: readout.cohort.size, cohort: readout.cohort.name })
  const percentileLine = percentileSub(t, readout.yourIndex, readout.cohortMedian, readout.percentile)

  return (
    <>
      <div data-slot="cohort-readout" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiTile
          size="large"
          label={t('benchmarks.yourIndex')}
          value={readout.yourIndex}
          locale={locale}
          unit={readout.yourIndex === null ? undefined : t('benchmarks.next.indexUnit')}
          sub={<span className="text-fg-label">{surveySub}</span>}
        />
        <KpiTile
          size="large"
          label={t('benchmarks.cohortMedianLabel')}
          value={readout.cohortMedian}
          locale={locale}
          unit={readout.cohortMedian === null ? undefined : t('benchmarks.next.indexUnit')}
          sub={<span className="text-fg-label">{cohortSub}</span>}
        />
        <KpiTile
          size="large"
          label={t('benchmarks.yourPercentile')}
          value={readout.percentile}
          locale={locale}
          unit={bandUnit(t, readout.percentile)}
          sub={percentileLine ? <span className="text-fg-label">{percentileLine}</span> : undefined}
        />
      </div>

      <CohortDimensionBars
        dimensions={readout.dimensions.map((dimension) => ({
          key: dimension.key,
          label: dimension.name,
          score: dimension.score,
          cohortMedian: dimension.median,
        }))}
        locale={locale}
        heading={t('benchmarks.next.byDimensionHeading')}
        summary={summary}
        cohortSize={readout.cohort.size}
        surveyTitle={readout.survey.title}
      />
    </>
  )
}

function ReferenceRow({
  reference,
  selected,
  onToggle,
  viewerCompanyId,
  t,
  locale,
}: {
  reference: BenchmarkReference
  selected: boolean
  onToggle: () => void
  viewerCompanyId: string | undefined
  t: TranslateFn
  locale: string
}) {
  const quality = qualityReading(reference)
  return (
    <tr data-benchmark-id={reference.id} className="border-b border-line-light last:border-b-0">
      <td className="px-3 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggle}
            aria-label={t('benchmarks.selectForComparison', { name: reference.name })}
          />
          <span className="truncate text-base text-fg-primary">{reference.name}</span>
        </div>
      </td>
      <td className="py-3 pr-3 text-base text-fg-primary">{benchmarkTypeLabel(t, reference.type)}</td>
      <td className="py-3 pr-3 text-base text-fg-primary">{benchmarkCategoryLabel(t, reference.category)}</td>
      <td className="py-3 pr-3">
        <Chip tone="neutral" label={t(scopeKey(reference.companyId, viewerCompanyId))} className="w-full justify-start" />
      </td>
      <td className="py-3 pr-3 text-base text-fg-primary">{reference.isActive ? t('common.yes') : t('common.no')}</td>
      <td data-slot="quality-score" className="py-3 pr-3 text-right">
        {quality.kind === 'unscored' ? (
          <span className="inline-flex items-center justify-end gap-1.5">
            <span aria-hidden="true" className="font-mono text-base text-fg-label">
              —
            </span>
            <span className="text-xs text-fg-label">{t('benchmarks.next.unscored')}</span>
          </span>
        ) : (
          <span className="font-mono text-base tabular-nums text-fg-primary">
            {formatMetric(quality.value, QUALITY_SCORE_FORMAT, locale)}
          </span>
        )}
      </td>
    </tr>
  )
}
