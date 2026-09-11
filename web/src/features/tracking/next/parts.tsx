import type { ReactNode } from 'react'
import { cn } from '../../../lib/cn'
import { initials } from './derive'

/**
 * The small pieces the tablero and the plan detail both draw, as the TrackingTablero and
 * Main artboards (10 Sep) draw them. Components only — `react(only-export-components)`
 * is a lint rule with a hard budget here.
 */

/**
 * The progress track with the compromiso as a mark at its end: an 8px recessed bar, the
 * reading in green (red once the compromiso has gone by), and a 2px tick where 100 %
 * sits. `percent` is already whole points (`semaforo.toPercent`) — nothing here scales.
 */
export function ProgressTrack({ percent, overdue, label }: { percent: number; overdue: boolean; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="relative h-2 rounded-sm bg-surface-icon-box"
    >
      <div
        className={cn('h-full rounded-sm', overdue ? 'bg-accent-red' : 'bg-accent-green')}
        style={{ width: `${percent}%` }}
      />
      <span
        aria-hidden="true"
        className={cn('absolute -top-1 right-0 h-4 w-0.5', overdue ? 'bg-accent-red' : 'bg-accent-green')}
      />
    </div>
  )
}

/** A recessed fact box: a label, the value, and one line under it. */
export function InfoBox({
  label,
  value,
  sub,
  mono = false,
  alarm = false,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  mono?: boolean
  alarm?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-0.5 rounded-md px-3 py-2.5',
        alarm ? 'border border-accent-red-ring bg-accent-red-soft' : 'bg-surface-outer',
      )}
    >
      <span className={cn('text-2xs font-bold uppercase tracking-label', alarm ? 'text-accent-red' : 'text-fg-label')}>{label}</span>
      <span className={cn('text-lg', mono && 'font-mono tabular-nums', alarm ? 'text-accent-red' : 'text-fg-primary')}>{value}</span>
      {sub && <span className={cn('text-sm', alarm ? 'text-accent-red' : 'text-fg-label')}>{sub}</span>}
    </div>
  )
}

/** The light avatar with a person's initials, or a dashed "·" when they have no name here. */
export function PersonaAvatar({ name, size = 'md' }: { name: string | null; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border bg-surface-icon-box font-semibold text-fg-secondary',
        size === 'sm' ? 'size-6 text-2xs' : 'size-7 text-xs',
        name ? 'border-line-default' : 'border-dashed border-line-default text-fg-label',
      )}
    >
      {name ? initials(name) : '·'}
    </span>
  )
}

/**
 * The round mark at the start of a bitácora row, where the Main artboard draws the author's
 * initials. `PlanResponse` names no author for any entry, so the row carries a glyph for WHAT
 * happened instead of a person the payload does not name.
 */
export function RowGlyph({ icon }: { icon: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      data-slot="bitacora-glyph"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line-default bg-surface-icon-box text-fg-secondary [&>svg]:size-3.5"
    >
      {icon}
    </span>
  )
}

/** A card of the tablero's "Dónde está el nodo" row: a label, a reading, a unit. */
export function NodoTile({ label, children, aside }: { label: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line-default bg-surface-card px-4 py-3.5 shadow-sm" data-slot="nodo-tile">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span data-slot="nodo-tile-label" className="whitespace-nowrap text-2xs font-bold uppercase tracking-label text-fg-label">
          {label}
        </span>
        {aside}
      </div>
      <div className="flex min-h-7 flex-wrap items-baseline gap-1.5">{children}</div>
    </div>
  )
}
