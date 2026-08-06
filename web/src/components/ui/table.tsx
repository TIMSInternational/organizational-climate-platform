import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * Ported from `climate-project/src/components/ui/table.tsx`, plus the sort and
 * empty-state support #77 asks for — several M2/M4 pages depend on both, and the
 * legacy table had neither.
 *
 * `index.css` already styles bare `table`/`th`/`td` for the twelve existing pages,
 * so these parts add structure and the scroll container rather than restating the
 * element rules.
 *
 * ## This component owns table width, because only it can (#218)
 *
 * `width: 100%` on a table is only safe next to something that scrolls. The base
 * layer used to carry both `table { width: 100% }` and `th { white-space: nowrap }`
 * as element rules, which is the same pair `Table` and `TableHead` use — but an
 * element rule cannot bring the container with it, so a table wider than its
 * parent had nowhere to go and rendered outside it. That defect was found twice
 * (#79 HeatMap, #80's four pages, each patched locally) before the rules moved
 * here. The base layer now styles cells only; **anything that renders a table
 * goes through `Table`**, which is enforced by `src/styles/tableOverflow.test.ts`
 * rather than left to memory.
 *
 * You may pass plain `<thead>/<tr>/<th>/<td>` as children — the base layer still
 * styles them, so a classless page gains the container without restating its
 * markup. The `Table*` parts below are for tables that need more than the
 * element layer gives.
 */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    // The wrapper is what scrolls: a wide table must not make the page scroll
    // sideways. `w-full` sits on the table rather than the base layer for the
    // reason in the block above; pass `className="w-auto"` for a table that
    // should shrink-wrap instead (HeatMap does).
    <div data-slot="table-container" className="w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom border-collapse text-base', className)}
        {...props}
      />
    </div>
  )
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-surface-icon-box font-medium', className)}
      {...props}
    />
  )
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-line-default transition-colors',
        'hover:bg-state-hover data-[state=selected]:bg-state-active',
        className,
      )}
      {...props}
    />
  )
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-control-lg px-3 text-left align-middle text-sm font-medium text-fg-secondary',
        'whitespace-nowrap',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-3 py-2 align-middle', className)}
      {...props}
    />
  )
}

export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-panel-gap text-sm text-fg-tertiary', className)}
      {...props}
    />
  )
}

export type SortDirection = 'asc' | 'desc'

/**
 * A sortable column header.
 *
 * Sets `aria-sort` on the `<th>`, which is the part a hand-rolled sort control
 * almost always misses — without it a screen-reader user cannot tell which column
 * is sorted, or which way.
 */
export function TableSortHeader({
  label,
  direction,
  onSort,
  className,
  ...props
}: Omit<ComponentProps<'th'>, 'children'> & {
  label: ReactNode
  /** `undefined` means this column is not the active sort. */
  direction?: SortDirection
  onSort: () => void
}) {
  const Icon = direction === 'asc' ? ArrowUpIcon : direction === 'desc' ? ArrowDownIcon : ArrowUpDownIcon

  return (
    <TableHead
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
      className={cn('p-0', className)}
      {...props}
    >
      <button
        type="button"
        data-slot="table-sort-button"
        onClick={onSort}
        className={cn(
          'flex h-control-lg w-full items-center gap-1 border-transparent bg-transparent px-3',
          'text-sm font-medium text-fg-secondary',
          'hover:bg-state-hover hover:text-fg-primary',
        )}
      >
        {label}
        <Icon
          aria-hidden="true"
          className={cn('size-3', direction ? 'text-fg-primary' : 'text-fg-light')}
        />
      </button>
    </TableHead>
  )
}

/**
 * The "no rows" row.
 *
 * A `<tr>` rather than a sibling block, so it lands inside `<tbody>` where the
 * table's own semantics keep it — and `colSpan` keeps the column count valid.
 */
export function TableEmpty({
  colSpan,
  children,
  className,
  ...props
}: ComponentProps<'td'> & { colSpan: number }) {
  return (
    <tr data-slot="table-empty">
      <td
        colSpan={colSpan}
        className={cn('px-3 py-section text-center text-sm text-fg-tertiary', className)}
        {...props}
      >
        {children}
      </td>
    </tr>
  )
}
