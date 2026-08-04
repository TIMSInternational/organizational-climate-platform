import type { ReactElement } from 'react'
import { ResponsiveContainer } from 'recharts'

interface ChartCanvasProps {
  width?: number
  height: number
  /**
   * The recharts chart element. Receives the size to render at, because
   * `ResponsiveContainer` injects width/height into its single child and a
   * fixed-size chart needs them passed explicitly.
   */
  children: ReactElement
}

/**
 * Sizes a recharts chart, responsively by default and explicitly when asked.
 *
 * ## Why explicit sizing exists at all
 *
 * `ResponsiveContainer` measures its parent through `getBoundingClientRect`,
 * which returns 0 under happy-dom. Probed rather than assumed:
 *
 * ```
 * explicit width/height   -> 1 <svg>, 2 bar rectangles, axis ticks ['a','b']
 * ResponsiveContainer     -> 0 <svg>, 0 rectangles
 *                            <div class="recharts-responsive-container"
 *                                 style="width:100%;height:200px">
 *                              <div style="width:0px"></div>
 *                            </div>
 * ```
 *
 * So a test that renders a responsive chart asserts against an empty div and
 * passes for the wrong reason, or fails for a reason that has nothing to do with
 * the component. **Tests pass `width`; the app omits it.**
 *
 * This is deliberately not solved by stubbing `getBoundingClientRect` globally:
 * that makes every chart test depend on a fixture that silently governs layout,
 * and the failure mode when it drifts is worse than passing a number.
 */
export default function ChartCanvas({ width, height, children }: ChartCanvasProps) {
  if (width !== undefined) {
    return children
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      {children}
    </ResponsiveContainer>
  )
}
