import { useTranslation } from '../../../../i18n'
import { DIVERGING_COLORS, ProtectedCell, divergingPair } from '../../../../components/charts'
import { Table } from '../../../../components/ui'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { MAP_DEAD_BAND_AT, MAP_EXTREME_AT, printedReading } from '../../../dashboard/next/compose'
import { reading, signedReading } from '../../../dashboard/next/derive'
import type { TrendDimension, TrendWave } from './model'

/**
 * "Los mismos números, en tabla" — the six charts' readings as the accessible table
 * the canvas draws under them: one row per closed wave (its name, when it closed and
 * how many of the drawn group answered it), one column per dimension, every reading tinted against the
 * target the way the Panel de Control's map tints it (`MAP_DEAD_BAND_AT`,
 * `MAP_EXTREME_AT`), and a last row with each dimension's move from the first wave to
 * the last.
 *
 * ## Three kinds of cell, never confused
 *
 * - A reading: the number, in its tint.
 * - A wave the floor withheld for this group: `ProtectedCell` — the hatch and the
 *   shield, and no number, whatever the payload carried.
 * - A dimension the wave did not ask: an em dash on the recessed surface, named for AT.
 *   Not hatched — a hatch claims a protection that was not applied — and never a zero.
 *
 * The move row prints a difference only when BOTH ends are readings: with one end
 * withheld, `last − first` beside the disclosed end would reconstruct the other.
 *
 * Why not `ClimateMap`: its rows carry a label and nothing under it, it has no summary
 * row, and it draws its own legend — the canvas's table has all three differently.
 */
export interface TrendsNumbersTableProps {
  waves: readonly TrendWave[]
  /** Per wave, for the drawn group: `true` when the floor withheld it. */
  withheld: readonly boolean[]
  /** Per wave, for the drawn group: its respondents, `null` when withheld. */
  respondents: readonly (number | null)[]
  dimensions: readonly TrendDimension[]
  target: number
  floor: number
  /** Already-translated accessible caption. */
  caption: string
}

const HEAD = 'px-1 pb-1 align-bottom text-2xs font-bold uppercase leading-tight tracking-label text-fg-secondary'

export default function TrendsNumbersTable({
  waves,
  withheld,
  respondents,
  dimensions,
  target,
  floor,
  caption,
}: TrendsNumbersTableProps) {
  const { t, locale } = useTranslation()
  const deadBand = MAP_DEAD_BAND_AT / (2 * MAP_EXTREME_AT)
  const first = waves[0]
  const lastIndex = waves.length - 1
  const last = waves[lastIndex]

  return (
    <Table data-slot="trends-table" className="border-separate border-spacing-1 text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className={cn(HEAD, 'w-44 pl-0 text-left')}>
            {t('surveys.next.trends.tableColSurvey')}
          </th>
          {dimensions.map((dimension) => (
            <th key={dimension.key} scope="col" className={cn(HEAD, 'text-center')}>
              {dimension.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {waves.map((wave, waveIndex) => (
          <tr key={wave.id} data-wave={wave.id}>
            <th scope="row" className="py-0 pr-2 pl-0 text-left align-middle font-normal">
              <span className="block text-base text-fg-primary">{wave.name?.trim() || wave.code}</span>
              <span className="block text-xs text-fg-label">
                {/* The count is the drawn GROUP's, never the survey's: "24 resp." beside
                    Ingeniería's row would be the company's figure under a department's
                    name. A withheld wave prints its date and nothing else. */}
                {respondents[waveIndex] === null || respondents[waveIndex] === undefined
                  ? t('surveys.next.trends.tableRowClosed', { date: calendarDay(Date.parse(wave.closedAt), locale) })
                  : t('surveys.next.trends.tableRowSub', {
                      date: calendarDay(Date.parse(wave.closedAt), locale),
                      count: respondents[waveIndex] ?? 0,
                    })}
              </span>
            </th>
            {dimensions.map((dimension) => {
              const value = dimension.values[waveIndex] ?? null
              if (withheld[waveIndex]) {
                return (
                  <td key={dimension.key} className="p-0">
                    <ProtectedCell
                      // 0, not a count: the wave is withheld for this group and no
                      // figure of it travels further down than it must.
                      responses={0}
                      threshold={Math.max(1, floor)}
                      description={`${wave.name?.trim() || wave.code}, ${dimension.name}`}
                      showWord={false}
                      suppressedClassName="h-10 w-full"
                    >
                      {null}
                    </ProtectedCell>
                  </td>
                )
              }
              if (value === null) {
                return (
                  <td key={dimension.key} className="p-0" data-slot="trends-not-asked">
                    <span className="flex h-10 items-center justify-center rounded bg-surface-icon-box text-fg-label">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">{t('surveys.next.trends.notAsked')}</span>
                    </span>
                  </td>
                )
              }
              const { fill, ink } = divergingPair((printedReading(value) - target) / (2 * MAP_EXTREME_AT), deadBand)
              return (
                <td key={dimension.key} className="p-0">
                  <span
                    data-slot="trends-cell"
                    // Which of the five steps, for a reader of the DOM: the fill itself is a
                    // `var()` reference a test cannot resolve.
                    data-tint={(DIVERGING_COLORS as readonly string[]).indexOf(fill)}
                    className="flex h-10 items-center justify-center rounded font-mono text-sm tabular-nums"
                    style={{ backgroundColor: fill, color: ink }}
                  >
                    {reading(value, locale)}
                  </span>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
      {first && last && lastIndex > 0 && (
        <tfoot>
          <tr data-slot="trends-move-row">
            <th scope="row" className="border-t border-line-light pt-1.5 pl-0 text-left text-sm font-semibold text-fg-primary">
              {`${first.code} → ${last.code}`}
            </th>
            {dimensions.map((dimension) => {
              const from = withheld[0] ? null : (dimension.values[0] ?? null)
              const to = withheld[lastIndex] ? null : (dimension.values[lastIndex] ?? null)
              const move = from === null || to === null ? null : to - from
              return (
                <td key={dimension.key} className="border-t border-line-light pt-1.5 text-center">
                  {move === null ? (
                    <span className="text-fg-label">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">{t('surveys.next.trends.noMove')}</span>
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'font-mono text-sm font-semibold tabular-nums',
                        move >= 0 ? 'text-accent-green-ink' : 'text-fg-primary',
                      )}
                    >
                      {signedReading(move, locale)}
                    </span>
                  )}
                </td>
              )
            })}
          </tr>
        </tfoot>
      )}
    </Table>
  )
}
