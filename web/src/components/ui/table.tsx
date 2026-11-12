import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react'
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * Whether the table stripes its body rows. A context rather than a class on the table, so
 * the stripe lands on the `<tr>` itself, in the same rule set as its hover — a selector
 * reaching down from the table (`[&>tbody>tr:nth-child(even)]`) out-specifies the row's
 * `hover:` and would freeze the hover off every second row.
 */
const TableZebraContext = createContext(false)

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
export type TableProps = ComponentProps<'table'> & {
  /**
   * Stripe every second body row (the canvas's `.tbl tbody tr:nth-child(even)`, on
   * `--admin-bg-zebra`, 4% grey). Off by default: a short table reads fine on its rules, and
   * the stripe is for long, wide ones where the eye has to carry a row across. Reaches
   * `TableRow` only — a plain `<tr>` child is not striped.
   */
  zebra?: boolean
}

export function Table({ className, zebra = false, ...props }: TableProps) {
  return (
    // The wrapper is what scrolls: a wide table must not make the page scroll
    // sideways. `w-full` sits on the table rather than the base layer for the
    // reason in the block above; pass `className="w-auto"` for a table that
    // should shrink-wrap instead (HeatMap does).
    <div data-slot="table-container" className="w-full overflow-x-auto">
      <TableZebraContext.Provider value={zebra}>
        <table
          data-slot="table"
          data-zebra={zebra || undefined}
          // 15px body rows (`--admin-text-base`) in tabular figures, so a column of numbers
          // lines up digit under digit. `index.css` sets the same on a bare `table`.
          className={cn('w-full caption-bottom border-collapse text-base tabular-nums', className)}
          {...props}
        />
      </TableZebraContext.Provider>
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
  const zebra = useContext(TableZebraContext)
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-line-default transition-colors',
        // The stripe is listed before the hover so the hover (a later variant in Tailwind's
        // order) still shows on a striped row.
        zebra && 'even:bg-surface-zebra',
        'hover:bg-state-hover data-[state=selected]:bg-state-active',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A column that holds figures: right-aligned and in tabular figures (the canvas's `.tbl .r`),
 * so the units line up and a wider number does not push its neighbours. Set it on the head
 * AND every cell of the column, or the head sits over the wrong edge.
 */
type NumericProp = { numeric?: boolean }

/**
 * The column head: the canvas's `.tbl th` — the secondary size (13px, `--admin-text-sm`),
 * semibold, in the tertiary ink (#6c6c71, 5.22:1 on the card), not uppercase.
 */
export function TableHead({ className, numeric = false, ...props }: ComponentProps<'th'> & NumericProp) {
  return (
    <th
      data-slot="table-head"
      data-numeric={numeric || undefined}
      className={cn(
        'h-control-lg px-3 text-left align-middle text-sm font-semibold text-fg-tertiary',
        'whitespace-nowrap',
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({ className, numeric = false, ...props }: ComponentProps<'td'> & NumericProp) {
  return (
    <td
      data-slot="table-cell"
      data-numeric={numeric || undefined}
      className={cn('px-3 py-2 align-middle', numeric && 'text-right tabular-nums', className)}
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
  numeric = false,
  className,
  ...props
}: Omit<ComponentProps<'th'>, 'children'> &
  NumericProp & {
    label: ReactNode
    /** `undefined` means this column is not the active sort. */
    direction?: SortDirection
    onSort: () => void
  }) {
  const Icon = direction === 'asc' ? ArrowUpIcon : direction === 'desc' ? ArrowDownIcon : ArrowUpDownIcon

  return (
    <TableHead
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
      numeric={numeric}
      className={cn('p-0', className)}
      {...props}
    >
      <button
        type="button"
        data-slot="table-sort-button"
        onClick={onSort}
        className={cn(
          'flex h-control-lg w-full items-center gap-1 rounded-none border-transparent bg-transparent px-3',
          numeric && 'justify-end',
          'text-sm font-semibold text-fg-tertiary',
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
