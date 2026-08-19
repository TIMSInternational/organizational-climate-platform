import { authFetch } from '../../../api/authFetch'

/**
 * `GET /search` — cross-entity search (#135).
 *
 * Mirrors `SearchDtos.cs`.
 *
 * ## Why this and not `/search/suggestions`
 *
 * The suggestions endpoint is documented as "the type-ahead shape", which is what the
 * command palette is, and it was the obvious choice. It is not usable here: `SearchSuggestion`
 * carries only `type`, `id`, `title` and `parentId`, and **two of the six searchable kinds
 * cannot be linked without a company id** — a user lives at
 * `/admin/companies/:companyId/users` and a report at `/admin/companies/:companyId/reports`.
 * `/search` returns `companyId` and `subtitle`, so every kind gets a real destination and a
 * second line. The extra payload is bounded by `limit`.
 */

/** One of the six kinds in `SearchEntityTypes`. */
export type SearchEntityType = 'survey' | 'question' | 'department' | 'user' | 'action_plan' | 'report'

export interface SearchResultItem {
  type: SearchEntityType
  id: string
  /** Never null and never empty — a hit with nothing to render is dropped server-side. */
  title: string
  /** A description, an email, or the parent survey's title for a question. */
  subtitle: string | null
  /** Null only for a row with no tenant. Needed to route users and reports. */
  companyId: string | null
  /** The survey a question belongs to; null for every other kind. */
  parentId: string | null
}

/** Present with an empty `items` when the kind was searched and matched nothing. */
export interface SearchResultGroup {
  type: SearchEntityType
  items: SearchResultItem[]
}

export interface SearchResponse {
  query: string
  groups: SearchResultGroup[]
  totalCount: number
}

/**
 * Runs a search.
 *
 * `limit` is per type and clamped server-side to 25; the palette asks for a small number
 * because it is a jump-to affordance rather than a results page — someone scrolling a
 * hundred hits wanted `/surveys`, not this.
 */
export async function search(
  baseUrl: string,
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query })
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const response = await authFetch(`${baseUrl}/search?${params.toString()}`, { signal: options.signal })
  return (await response.json()) as SearchResponse
}

/**
 * Where a hit lives in this app.
 *
 * Returns `null` when the row cannot be routed — a user or report whose `companyId` is
 * absent, which the API allows. A row with no destination is dropped rather than rendered
 * as a dead entry: a palette that navigates nowhere is worse than one that omits the hit.
 */
export function hrefForResult(item: SearchResultItem): string | null {
  switch (item.type) {
    case 'survey':
      return `/surveys/${item.id}`
    // A question is not a page. Its survey is, and `parentId` is that survey.
    case 'question':
      return item.parentId ? `/surveys/${item.parentId}` : null
    case 'action_plan':
      return `/action-plans/${item.id}`
    case 'department':
      // Flat route by design (#142) — the page takes its company from company-context.
      return '/departments'
    case 'user':
      return item.companyId ? `/admin/companies/${item.companyId}/users` : null
    case 'report':
      return item.companyId ? `/admin/companies/${item.companyId}/reports` : null
    default:
      return null
  }
}
