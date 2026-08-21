import { KpiTile } from '../../../components/charts'
import { useTranslation } from '../../../i18n'
import type { SemaforoCounts } from '../api/trackingApi'
import {
  SEMAFORO_ORDER,
  countsCoverTotal,
  semaforoCount,
  semaforoPresentation,
  totalPlanes,
} from '../semaforo'
import SemaforoChip from './SemaforoChip'

/**
 * The reading strip every tracking screen opens with: every plan, then the three
 * semáforo states worst-first.
 *
 * Worst-first (`SEMAFORO_ORDER`) rather than alphabetical or good-first, because
 * the whole point of the semáforo for a node leader is "what do I have to deal
 * with today" — the number that should catch the eye is the red one.
 *
 * ## This component has no icons of its own, and that is the fix
 *
 * It used to keep a private `Record<SemaforoEstado, ReactNode>` of lucide glyphs
 * beside a private `TONE_TEXT` map, which meant the shape guarantee pinned in
 * `semaforo.test.ts` covered the chips in the table below and NOT the strip above
 * them — the first thing a reader sees. With no test file of its own, the strip
 * could be reduced to three bare coloured dots, no word and no shape, and 2910
 * tests stayed green. That is precisely the WCAG 1.4.1 failure the client's §7
 * mandate exists to prevent, on the one element that gets photographed for a
 * report.
 *
 * So each state wears the same `SemaforoChip` the rest of the module uses. One
 * mark for one meaning: the reader learns this chip once and meets it everywhere,
 * and its fill/ink pairing is the measured one (`chipVariants.ts`, worst case
 * 5.59:1) rather than a colour invented for this tile. `SemaforoSummary.test.tsx`
 * now pins the word and the distinct silhouette here as well.
 *
 * ## Why the three state tiles are not `KpiTile`s
 *
 * `KpiTile.label` is a `string`, and it has to be — the tile's label is 10px
 * uppercase text, not a slot. A semáforo tile's label is the state, and the state
 * is a word *plus a glyph*; passing "Rojo" as a bare string would drop the outline
 * that makes the strip legible in greyscale, which is the one property this strip
 * exists to have.
 *
 * So the total wears `KpiTile` — it is a plain number and belongs in the shared
 * component — and the three states wear the same geometry with a `SemaforoChip`
 * where the label goes. The typography is copied deliberately rather than
 * approximated: `font-mono text-3xl tabular-nums` is the rule that makes this
 * product read as an instrument, and a tile that opted out would be visibly a
 * different size in the same row.
 *
 * ## Counting is not aggregation of answers
 *
 * These are counts of ACTION PLANS, which are named operational records with a
 * responsable and a compromiso date. They are not survey responses and there is no
 * anonymity floor to apply to them: a node with one plan is a node with one plan,
 * and saying so reveals nothing about who answered what. The ≥5 floor governs the
 * survey aggregates a plan may have been created FROM, which live behind
 * `hallazgoExternalId` on the other service and are not drawn here.
 */
export interface SemaforoSummaryProps {
  counts: SemaforoCounts
  /**
   * The server's own plan total, when the payload carries one.
   *
   * The consolidado has `totalPlanes` from the server and the tablero does not, so
   * the default is the sum of the three counts. When both exist they must agree —
   * `CountSemaforo` and `g.Count()` run over the same list — and when they do not,
   * the strip says so rather than quietly showing a total that the three numbers
   * beneath it do not add up to. See `countsCoverTotal`.
   */
  total?: number
  locale?: string
  className?: string
}

export default function SemaforoSummary({
  counts,
  total,
  locale,
  className,
}: SemaforoSummaryProps) {
  const { t } = useTranslation()
  const covered = countsCoverTotal(counts, total)

  return (
    <div className={className}>
      {/* Named, because "Atrasado" appears in three places on these pages — this
          summary, the estado filter and every red row's chip — and a reader landing
          on a bare list of four numbers has nothing to tell them which is which. */}
      <ul
        aria-label={t('tracking.semaforo.summaryLabel')}
        className="mb-panel-gap grid list-none grid-cols-2 gap-inline p-0 lg:grid-cols-4"
      >
        <li>
          <KpiTile
            label={t('tracking.totalPlanes')}
            value={total ?? totalPlanes(counts)}
            locale={locale}
            sub={t('tracking.totalPlanesSub')}
          />
        </li>
        {SEMAFORO_ORDER.map((estado) => {
          const { subKey } = semaforoPresentation(estado)
          return (
            <li
              key={estado}
              data-slot="semaforo-tile"
              // Same box as `KpiTile` — see the component note on why the geometry
              // is repeated rather than imported.
              className="rounded-lg border border-line-light bg-surface-icon-box p-3"
            >
              {/* The chip, not a bare icon beside 10px uppercase text.
                  Photographed at 1440x900 in both themes, an early cut of this tile
                  inherited `text-fg-secondary` for the whole label row — so the
                  glyph came out grey and the summary strip had NO colour channel at
                  all, while every state chip in the table below it did. */}
              <SemaforoChip estado={estado} />
              <div className="mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums">
                {semaforoCount(counts, estado)}
              </div>
              <div className="mt-px text-xs text-fg-secondary">{t(subKey)}</div>
            </li>
          )
        })}
      </ul>

      {/* Only when the two disagree, which today they cannot: `EstadoSemaforo` has
          exactly three members, so this is the disclosure that arrives with a
          fourth rather than a line of copy the reader has to ignore meanwhile. */}
      {!covered && (
        <p className="mb-panel-gap text-xs text-fg-secondary" data-slot="semaforo-partial">
          {t('tracking.countsPartial', { shown: totalPlanes(counts), total: total ?? 0 })}
        </p>
      )}
    </div>
  )
}
