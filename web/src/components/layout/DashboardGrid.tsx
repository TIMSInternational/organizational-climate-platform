import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import {
  GRID_COLUMNS,
  GRID_GAP,
  GRID_SPAN,
  type GridColumns,
  type GridGap,
} from './gridClasses'

/**
 * Responsive dashboard grid. Ported from `climate-project/src/components/layout/DashboardGrid.tsx`.
 *
 * Needed by #132 and #133, which is why it lands with #80 rather than with the
 * pages that consume it.
 *
 * Two deviations from the legacy version, both deliberate:
 *
 * - **`GridItem` is a plain `<div>`, not a `motion.div`.** framer-motion is not
 *   ported anywhere in this repo (#75–#77 dropped ~1700 lines of it). The legacy
 *   `delay` prop existed only to stagger that entrance, so it is gone rather than
 *   kept as a no-op that silently does nothing — a stagger can come back as
 *   `animate-slide-up` plus an inline `animation-delay` if a page wants one.
 * - **The class tables live in `./gridClasses.ts`**, which is where the reason is
 *   written down. Short version: an interpolated `grid-cols-${n}` compiles to
 *   nothing, so the classes must be literal, and a separate module is what lets
 *   `styles/utilityExistence.test.ts` check them at all.
 */

export type { GridColumns, GridGap }

export interface DashboardGridProps extends Omit<ComponentProps<'div'>, 'children'> {
  children: ReactNode
  /** Columns at the widest breakpoint. Always one column on a phone. */
  columns?: GridColumns
  gap?: GridGap
}

export function DashboardGrid({
  children,
  className,
  columns = 3,
  gap = 'md',
  ...props
}: DashboardGridProps) {
  return (
    <div
      data-slot="dashboard-grid"
      className={cn('grid', GRID_COLUMNS[columns], GRID_GAP[gap], className)}
      {...props}
    >
      {children}
    </div>
  )
}

export interface GridItemProps extends Omit<ComponentProps<'div'>, 'children'> {
  children: ReactNode
  /** Columns to span at the widest breakpoint. Always one on a phone. */
  span?: GridColumns
}

export function GridItem({ children, className, span = 1, ...props }: GridItemProps) {
  return (
    // `min-w-0` because a grid track is `min-width: auto` by default, so one wide
    // child (a table, a chart's own minimum) pushes the track past its share and
    // the whole grid overflows its container rather than the child scrolling.
    <div data-slot="grid-item" className={cn(GRID_SPAN[span], 'min-w-0', className)} {...props}>
      {children}
    </div>
  )
}

/**
 * The three named layouts the legacy dashboards used. Kept because they are the
 * names #132/#133 will reach for, and because "four across for KPIs, two for
 * charts, three for detail" is a decision worth making once.
 */
export function KPIGrid({ children, ...props }: Omit<DashboardGridProps, 'columns' | 'gap'>) {
  return (
    <DashboardGrid columns={4} gap="md" {...props}>
      {children}
    </DashboardGrid>
  )
}

export function ChartGrid({ children, ...props }: Omit<DashboardGridProps, 'columns' | 'gap'>) {
  return (
    <DashboardGrid columns={2} gap="lg" {...props}>
      {children}
    </DashboardGrid>
  )
}

export function DetailGrid({ children, ...props }: Omit<DashboardGridProps, 'columns' | 'gap'>) {
  return (
    <DashboardGrid columns={3} gap="md" {...props}>
      {children}
    </DashboardGrid>
  )
}
