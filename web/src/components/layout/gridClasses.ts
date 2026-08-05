/**
 * The responsive class tables `DashboardGrid` picks from.
 *
 * ## Why these live in a module of their own
 *
 * They have to be written out per option: `` `grid-cols-${columns}` `` compiles
 * to nothing, because Tailwind scans source *text* and cannot see a class
 * assembled at runtime. So the classes end up as values inside an object literal
 * — and `styles/utilityExistence.test.ts` deliberately does not descend into
 * object literals (a cva variant table puts *keys* like `sm` and `destructive`
 * where a class would be, which produces pure noise). Its `className`-attribute
 * sweep therefore cannot see these, whether they sit in the `.tsx` or here.
 *
 * Pulling them out into a plain module makes them *importable*, so the guard
 * checks them explicitly by name instead of not at all — see the
 * "dashboard grid class tables" case in `styles/utilityExistence.test.ts`. That
 * is the opposite trade-off from `charts/participation.ts`, which returns a
 * semantic state precisely so the class stays in the component where the sweep
 * can see it; that works only because a status colour is one class, not a
 * breakpoint set.
 */

export type GridColumns = 1 | 2 | 3 | 4
export type GridGap = 'sm' | 'md' | 'lg'

/**
 * Stock numeric steps, which resolve through `--spacing` = `--admin-space-4`
 * (4px), so these are the legacy 16 / 24 / 32px exactly. Mind the two numbering
 * systems documented in `styles/theme.css`: `gap-4` is four *steps*, not 4px.
 */
export const GRID_GAP: Record<GridGap, string> = {
  sm: 'gap-4',
  md: 'gap-6',
  lg: 'gap-8',
}

export const GRID_COLUMNS: Record<GridColumns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
}

export const GRID_SPAN: Record<GridColumns, string> = {
  1: 'col-span-1',
  2: 'col-span-1 md:col-span-2',
  3: 'col-span-1 md:col-span-2 lg:col-span-3',
  4: 'col-span-1 md:col-span-2 lg:col-span-4',
}
