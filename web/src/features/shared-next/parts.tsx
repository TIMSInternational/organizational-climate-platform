import type { HTMLAttributes, ReactNode } from 'react'
import { Button } from '../../components/ui'
import { cn } from '../../lib/cn'

/**
 * The handful of shapes the administrator-authoring artboards repeat — a card, a card's
 * serif heading with its count, an icon box, an empty row, a quiet note and a two-way
 * segmented switch. They live here rather than in `components/ui` because they are the
 * canvas's page grammar, not primitives: each one is a composition of tokens the
 * primitives already use (`bg-surface-card`, `border-line-default`, `tracking-eyebrow`).
 */

export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('rounded-lg border border-line-default bg-surface-card p-card', className)}
      {...rest}
    >
      {children}
    </section>
  )
}

export function PanelHeading({
  title,
  count,
  aside,
  id,
}: {
  title: string
  count?: number
  aside?: ReactNode
  id?: string
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-inline">
      <h2 id={id} className="m-0 flex items-baseline gap-2 text-xl">
        {title}
        {count !== undefined && (
          <span className="font-mono text-xs text-fg-secondary tabular-nums">{count}</span>
        )}
      </h2>
      {aside && <div className="text-xs text-fg-secondary">{aside}</div>}
    </div>
  )
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('m-0 text-2xs font-bold uppercase tracking-eyebrow text-fg-label', className)}>
      {children}
    </p>
  )
}

export function IconBox({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line-light bg-surface-icon-box text-fg-secondary [&>svg]:size-4"
    >
      {children}
    </span>
  )
}

/** An honest "nothing here" inside a table or card: what is absent, and why. */
export function EmptyRow({
  icon,
  title,
  lines,
  className,
}: {
  icon: ReactNode
  title: string
  lines: ReactNode[]
  className?: string
}) {
  return (
    <div data-slot="empty-row" className={cn('flex items-start gap-3 p-4', className)}>
      <IconBox>{icon}</IconBox>
      <div className="min-w-0">
        <p className="m-0 text-sm font-semibold text-fg-primary">{title}</p>
        {lines.map((line, index) => (
          <p
            key={index}
            className={cn('m-0 max-w-measure text-xs', index === 0 ? 'text-fg-primary' : 'text-fg-secondary')}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}

export function Note({ icon, children, className }: { icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div
      data-slot="note"
      className={cn(
        'flex items-start gap-2 rounded-lg bg-surface-icon-box px-4 py-3 text-xs text-fg-secondary [&>svg]:mt-0.5 [&>svg]:size-3.5 [&>svg]:shrink-0',
        className,
      )}
    >
      {icon}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Two or three mutually exclusive options, drawn as the artboards' pill switch. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-md border border-line-light bg-surface-icon-box p-0.5"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant="ghost"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-7 px-3 text-xs',
            option.value === value
              ? 'bg-surface-card text-fg-primary shadow-sm'
              : 'text-fg-secondary hover:text-fg-primary',
          )}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

/** The table header cell the artboards use: 10px, bold, uppercase, tracked. */
export const TH_CLASS =
  'px-3 py-2 text-left text-2xs font-bold uppercase tracking-wider text-fg-label whitespace-nowrap'

export const TABLE_CARD_CLASS = 'overflow-hidden rounded-lg border border-line-default bg-surface-card'
