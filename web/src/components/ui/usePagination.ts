import { useMemo } from 'react'

/**
 * The page-window calculation from
 * `climate-project/src/components/ui/pagination.tsx`.
 *
 * Kept in its own module so `pagination.tsx` exports only components —
 * react-refresh needs that to hot-reload them.
 */

export interface PaginationRange {
  /** Page numbers to render, with `null` marking a gap. */
  items: (number | null)[]
  totalPages: number
  canPreviousPage: boolean
  canNextPage: boolean
}

/**
 * The page list to render: first, last, a window around the current page, and
 * `null` where pages were elided.
 */
export function usePagination({
  page,
  pageSize,
  totalItems,
  siblings = 1,
}: {
  page: number
  pageSize: number
  totalItems: number
  siblings?: number
}): PaginationRange {
  return useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
    const first = 1
    const last = totalPages

    const windowStart = Math.max(first, page - siblings)
    const windowEnd = Math.min(last, page + siblings)

    const pages = new Set<number>([first, last])
    for (let p = windowStart; p <= windowEnd; p += 1) pages.add(p)

    const sorted = [...pages].filter((p) => p >= first && p <= last).sort((a, b) => a - b)

    const items: (number | null)[] = []
    let previous: number | undefined
    for (const current of sorted) {
      // A single missing page is rendered as that page, not as an ellipsis that
      // hides exactly one number.
      if (previous !== undefined && current - previous === 2) items.push(previous + 1)
      else if (previous !== undefined && current - previous > 2) items.push(null)
      items.push(current)
      previous = current
    }

    return {
      items,
      totalPages,
      canPreviousPage: page > first,
      canNextPage: page < last,
    }
  }, [page, pageSize, totalItems, siblings])
}
