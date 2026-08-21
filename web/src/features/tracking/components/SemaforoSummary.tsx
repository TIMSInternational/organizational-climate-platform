import { KpiTile } from '../../../components/charts'
import { useTranslation } from '../../../i18n'
import { SEMAFORO_ESTADOS, SEMAFORO_PRESENTATION, semaforoCount, totalPlanes } from '../semaforo'
import SemaforoChip from './SemaforoChip'
import type { SemaforoCounts } from '../api/trackingApi'

/**
 * The four-across reading strip both dashboards open with: every plan, then the
 * three semáforo states worst-first.
 *
 * ## Why the three state tiles are not `KpiTile`s
 *
 * `KpiTile.label` is a `string`, and it has to be — the tile's label is 10px
 * uppercase text, not a slot. A semáforo tile's label is the state, and the state
 * is a word *plus a glyph* (see `semaforo.ts`); passing "Rojo" as a bare string
 * would drop the outline that makes the strip legible in greyscale, which is the
 * one property this strip exists to have.
 *
 * So the total wears `KpiTile` — it is a plain number and belongs in the shared
 * component — and the three states wear the same geometry with a `SemaforoChip`
 * where the label goes. The typography is copied deliberately rather than
 * approximated: `font-mono text-3xl tabular-nums` is the rule that makes this
 * product read as an instrument, and a tile that opted out would be visibly a
 * different size in the same row.
 */
export interface SemaforoSummaryProps {
  counts: SemaforoCounts
  /**
   * Overrides the derived total. The consolidado has `totalPlanes` from the server
   * and the tablero does not, so the default is the sum of the three counts — which
   * must agree with the server's figure, since `CountSemaforo` and `g.Count()` run
   * over the same list.
   */
  total?: number
  locale?: string
}

export default function SemaforoSummary({ counts, total, locale }: SemaforoSummaryProps) {
  const { t } = useTranslation()

  return (
    <div className="mb-panel-gap grid grid-cols-2 gap-inline lg:grid-cols-4">
      <KpiTile
        label={t('tracking.totalPlanes')}
        value={total ?? totalPlanes(counts)}
        locale={locale}
        sub={t('tracking.totalPlanesSub')}
      />
      {SEMAFORO_ESTADOS.map((estado) => {
        const { subKey } = SEMAFORO_PRESENTATION[estado]
        return (
          <div
            key={estado}
            data-slot="semaforo-tile"
            // Same box as `KpiTile` — see the component note on why the geometry is
            // repeated rather than imported.
            className="rounded-lg border border-line-light bg-surface-icon-box p-3"
          >
            {/* The chip, not a bare icon beside 10px uppercase text.
                Photographed at 1440x900 in both themes, the first cut of this tile
                inherited `text-fg-secondary` for the whole label row — so the glyph
                came out grey and the summary strip had NO colour channel at all,
                while every state chip in the table below it did. One mark for one
                meaning: the reader learns this chip once and meets it everywhere in
                the module, and its fill/ink pairing is the measured one
                (`chipVariants.ts`, worst case 5.59:1) rather than a colour invented
                for this tile. */}
            <SemaforoChip estado={estado} />
            <div className="mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums">
              {semaforoCount(counts, estado)}
            </div>
            <div className="mt-px text-xs text-fg-secondary">{t(subKey)}</div>
          </div>
        )
      })}
    </div>
  )
}
