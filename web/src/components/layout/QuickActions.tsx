import { Link } from 'react-router'
import { Card, CardContent } from '../ui'

/**
 * A grid of destination tiles — ForMaps' `dashboard/_components/QuickActions.tsx`.
 *
 * Theirs, verbatim in shape: a card with a heading, then a two-column grid of
 * tiles at `gap: 2`, each a bordered `rounded-xl` block that centres an icon over
 * its label and lifts its border on hover. The icon sits in a 36px rounded tile,
 * the label is 12px/500 with tight leading.
 *
 * ## Why the tiles are not six colours
 *
 * ForMaps tints each tile a different stock Tailwind pair — `text-indigo-600
 * bg-indigo-50`, `text-emerald-600 bg-emerald-50`, and so on. Two reasons that
 * does not port:
 *
 * - `tokenDiscipline` rejects a stock palette step anywhere under `layout/`, and
 *   the colours are decoration rather than meaning, so there is no token to reach
 *   for instead.
 * - this product already decided the same question the other way in
 *   `charts/KPIDisplay.tsx`, whose per-card `color` prop was dropped because four
 *   of its six options were the reserved status colours — so "engagement" could be
 *   green and "attrition" could be green, and green stopped meaning anything. A
 *   green tile beside a red one here would read as a judgement about the
 *   destination.
 *
 * So every tile gets the one accent tint, which is also the sidebar mark's — the
 * icon still distinguishes them, and it distinguishes them by what they are.
 */
export interface QuickAction {
  /** Stable identity, used as the React key. */
  id: string
  /** Already-translated. This never translates its own copy. */
  label: string
  /** In-app path. */
  href: string
  icon: React.ComponentType<{ className?: string }>
}

export interface QuickActionsProps {
  actions: readonly QuickAction[]
  /** Already-translated section heading. Omit for an unheaded grid. */
  title?: string
  /** Tiles per row from `md` up. Two is ForMaps'. */
  columns?: 2 | 3 | 4
}

const COLUMN_CLASSES: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
}

export function QuickActions({ actions, title, columns = 2 }: QuickActionsProps) {
  if (actions.length === 0) return null

  return (
    <Card data-slot="quick-actions">
      <CardContent className="flex flex-col gap-4">
        {title ? <h3 className="m-0">{title}</h3> : null}
        <div className={`grid gap-inline ${COLUMN_CLASSES[columns]}`}>
          {actions.map((action) => (
            <Link
              key={action.id}
              to={action.href}
              className="flex flex-col items-center justify-center gap-inline rounded-xl border border-line-default p-3 text-center text-fg-primary no-underline hover:border-line-hover hover:bg-state-hover"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-accent-blue-soft text-accent-blue">
                <action.icon className="size-icon" />
              </span>
              {/* `leading-tight`: a two-word label wraps in a 2-column grid at
                  320px, and the default leading opens a visible gap between the
                  two lines that makes the tile read as two labels. */}
              <span className="text-sm font-medium leading-tight">{action.label}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
