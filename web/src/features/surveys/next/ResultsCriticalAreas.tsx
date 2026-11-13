import { useMemo, useState } from 'react'
import { useTranslation } from '../../../i18n'
import { BandGlyph, bandCellStyle } from '../../../components/charts'
import { Button } from '../../../components/ui'
import { criticalByDimension, criticalByGroup, type CriticalCell } from './derive'

/** The section's id, which the fourth tile's "Ver cuáles" scrolls to. */
export const CRITICAL_SECTION_ID = 'results-next-critical'

type Grouping = 'dimension' | 'group'

/**
 * Every critical cell of the map, gathered, under "Dónde mirar primero".
 *
 * The fourth tile used to print the cells itself as one line joined by `·`, the same mark
 * that joins a group to its dimension. With ESPH Clima's twelve cells (3 Nov 2026) the
 * tile was a red paragraph in which no reader could tell where one cell ended. The tile
 * now gives the count and the spread; the cells are read here:
 *
 * - **By dimension** first, the dimension critical in the most groups at the top, because
 *   that points at something company-wide rather than at one team.
 * - **By group** on request, for a reader planning one team's actions.
 *
 * Each cell opens its question exactly as a cell of the map does. With no group rows
 * (`companyOnly`) the cells are the company's own, which the map does not open, so they
 * are printed and not offered as buttons.
 */
export default function ResultsCriticalAreas({
  cells,
  companyOnly,
  heading,
  rangeText,
  dimensionName,
  score,
  onOpen,
}: {
  cells: readonly CriticalCell[]
  companyOnly: boolean
  /** The company's own name for the critical area. */
  heading: string
  /** "menos de 3,80", on the company's scale. */
  rangeText: string
  dimensionName: (key: string) => string
  score: (value: number) => string
  onOpen: (rowId: string, dimensionKey: string) => void
}) {
  const { t } = useTranslation()
  const [grouping, setGrouping] = useState<Grouping>('dimension')
  const groupCount = useMemo(() => new Set(cells.map((cell) => cell.rowId)).size, [cells])
  const dimensionCount = useMemo(() => new Set(cells.map((cell) => cell.dimensionKey)).size, [cells])
  // Offered only when both readings differ: one group, or one dimension, has one reading.
  const canRegroup = !companyOnly && groupCount > 1 && dimensionCount > 1
  const byGroup = canRegroup && grouping === 'group'
  const clusters = useMemo(() => (byGroup ? criticalByGroup(cells) : criticalByDimension(cells)), [cells, byGroup])

  return (
    <section
      id={CRITICAL_SECTION_ID}
      aria-labelledby={`${CRITICAL_SECTION_ID}-heading`}
      // The tile's link scrolls here; the margin keeps the heading clear of the top edge.
      className="flex scroll-mt-4 flex-col gap-3"
      data-testid="critical-areas"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          {/* -1: the tile's "Ver cuáles" moves focus here, so a keyboard reader lands on it. */}
          <h2 id={`${CRITICAL_SECTION_ID}-heading`} tabIndex={-1} className="mb-0 text-2xl">
            {heading}
          </h2>
          <span className="text-sm tabular-nums text-fg-label">{cells.length}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 text-sm text-fg-label">
            {t(companyOnly ? 'resultBands.results.criticalSubStatic' : 'resultBands.results.criticalSub', {
              range: rangeText,
            })}
          </p>
          {canRegroup && (
            <div
              role="group"
              aria-label={t('resultBands.results.criticalGroupingLabel')}
              className="inline-flex rounded-md border border-line-default p-0.5"
            >
              {(['dimension', 'group'] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={grouping === option ? 'secondary' : 'ghost'}
                  aria-pressed={grouping === option}
                  onClick={() => setGrouping(option)}
                  className="h-7 px-2.5 text-sm font-normal"
                >
                  {t(option === 'dimension' ? 'resultBands.results.criticalByDimension' : 'resultBands.results.criticalByGroup')}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      <ul className="m-0 flex list-none flex-col rounded-xl border border-line-panel bg-surface-card p-0">
        {clusters.map((cluster) => {
          const first = cluster.cells[0]
          const title = byGroup ? (first?.rowName ?? '') : dimensionName(cluster.key)
          const count = cluster.cells.length
          return (
            <li
              key={cluster.key}
              data-cluster={cluster.key}
              className="grid gap-x-4 gap-y-2 border-b border-line-light px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-base font-semibold text-fg-primary">{title}</span>
                {!companyOnly && (
                  <span className="text-xs text-fg-label">
                    {byGroup
                      ? count === 1
                        ? t('resultBands.results.criticalInDimensionsOne')
                        : t('resultBands.results.criticalInDimensions', { count })
                      : count === 1
                        ? t('resultBands.results.criticalInGroupsOne')
                        : t('resultBands.results.criticalInGroups', { count })}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {cluster.cells.map((cell) => {
                  // What the chip names beside its score: the other half of the cell.
                  const label = companyOnly ? null : byGroup ? dimensionName(cell.dimensionKey) : cell.rowName
                  const box = (
                    <span
                      data-band="critical"
                      className="inline-flex h-6 min-w-10 shrink-0 items-center justify-center gap-1 rounded border px-1.5 text-sm font-semibold tabular-nums"
                      style={bandCellStyle('critical')}
                    >
                      {/* The band's glyph before the figure, as on the map: the red alone
                          never names the area (accessibility.md; ruling of 1 Oct). The
                          section's heading is the area's name. */}
                      <span aria-hidden="true" data-testid="critical-glyph" className="inline-flex text-xs">
                        <BandGlyph band="critical" />
                      </span>
                      {score(cell.score)}
                    </span>
                  )
                  if (label === null) {
                    return (
                      <span key={`${cell.rowId}:${cell.dimensionKey}`} className="inline-flex">
                        {box}
                      </span>
                    )
                  }
                  return (
                    <Button
                      key={`${cell.rowId}:${cell.dimensionKey}`}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onOpen(cell.rowId, cell.dimensionKey)}
                      aria-label={t('resultBands.results.criticalOpen', {
                        cell: `${cell.rowName} · ${dimensionName(cell.dimensionKey)}`,
                        score: score(cell.score),
                      })}
                      className="h-auto max-w-full gap-2 py-1 pr-2.5 pl-1 text-sm font-normal text-fg-primary"
                    >
                      {box}
                      <span className="truncate">{label}</span>
                    </Button>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
