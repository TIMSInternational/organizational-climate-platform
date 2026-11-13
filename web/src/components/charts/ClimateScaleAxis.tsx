import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import { scalePercent } from './climateRange'
import { SCALE_MAX, SCALE_MIN, scoreText, type ResultScale } from './resultBands'

/**
 * The 1…5 under a column of climate bars, each figure set exactly where its value falls
 * on the track (`scalePercent`), the ends held inside the track's edges. On a company that
 * reads on 0–100 the same five points print as 20…100 (`scoreText`), because the track is
 * the same line either way.
 *
 * `aria-hidden`: an axis helps the eye estimate a mark, and every bar already states its
 * own figures in its accessible label (HIG, Charts › Enhancing the accessibility of a
 * chart: "Hide visible text labels for axes and ticks from assistive technologies").
 *
 * 12px, not the canvas's 11: the floor of 11 is for uppercase tracked labels only.
 */
export default function ClimateScaleAxis({ scale = 'mean', className }: { scale?: ResultScale; className?: string }) {
  const { locale } = useTranslation()
  const points = Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, index) => SCALE_MIN + index)
  return (
    <div aria-hidden="true" data-climate-axis="" className={cn('relative h-4 text-xs text-fg-tertiary tabular-nums', className)}>
      {points.map((point) => {
        const left = scalePercent(point)
        const shift = left <= 0 ? '0' : left >= 100 ? '-100%' : '-50%'
        return (
          <span key={point} data-axis-point={point} className="absolute top-0" style={{ left: `${left}%`, transform: `translateX(${shift})` }}>
            {scoreText(point, scale, locale, 0)}
          </span>
        )
      })}
    </div>
  )
}
