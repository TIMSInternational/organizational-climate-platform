import type { ReactNode } from 'react'
import { Chip } from '../../../components/ui'
import { cn } from '../../../lib/cn'
import { useTranslation } from '../../../i18n'
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

/** The artboards' small amber "Datos de muestra" chip, on a sample-fed region only. */
export function SampleChip({ className }: { className?: string }) {
  const { t } = useTranslation()
  return <Chip tone="warning" label={t('dashboard.next.sampleChip')} data-slot="sample-chip" className={cn('normal-case tracking-normal', className)} />
}

/**
 * A card of the tablero's "Dónde está el nodo" row: a label, a reading, a unit.
 *
 * `note` is a line of its own under the reading — where a sample-fed tile wears its chip, so
 * the label and the reading keep the rows the other three tiles set. In the label row the
 * chip wrapped under "Avances registrados" at 1440 and pushed that tile's reading a row down.
 */
export function NodoTile({
  label,
  children,
  aside,
  note,
}: {
  label: string
  children: ReactNode
  aside?: ReactNode
  note?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line-default bg-surface-card px-4 py-3.5 shadow-sm" data-slot="nodo-tile">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="whitespace-nowrap text-2xs font-bold uppercase tracking-label text-fg-label">{label}</span>
        {aside}
      </div>
      <div className="flex min-h-7 flex-wrap items-baseline gap-1.5">{children}</div>
      {note && (
        <div data-slot="nodo-tile-note" className="flex">
          {note}
        </div>
      )}
    </div>
  )
}
