import type { QuestionCategory, QuestionLibraryItem } from '../../features/questions/api/questionLibrary'

/**
 * The rules that decide what the shared question picker offers, kept out of the
 * component because every one of them is a claim that can be wrong quietly.
 *
 * `QuestionLibraryBrowser.tsx` renders; this file decides. The split is what lets
 * the decisions be tested without a DOM, and what keeps the component from growing a
 * second copy of any of them.
 */

/**
 * Comparison form for search: lower-cased and stripped of diacritics.
 *
 * The library is bilingual by construction — `NameEn`/`NameEs` and `TextEn`/`TextEs`
 * are BOTH required server-side — so an admin typing `comunicacion` must find
 * `Comunicación`. Without the fold, half the corpus is unreachable from a keyboard
 * that does not produce accents, which is most of them.
 */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase()
}

/** A row that carries library ownership. Both categories and items do. */
interface CompanyOwned {
  companyId: string | null
}

/**
 * The rows a picker creating content for `companyId` may offer: the GLOBAL rows
 * (`companyId === null`) plus that company's own.
 *
 * Done here rather than by passing `?companyId=` to the server, and the difference
 * matters in both directions. For a CompanyAdmin the server already scopes to
 * `CompanyId == null || CompanyId == own`, so this is a no-op. For a SuperAdmin —
 * who has no implicit tenant — an unfiltered list is EVERY tenant's questions, and
 * picking one company's question into another company's survey is a cross-tenant
 * content leak wearing a read's clothing. Passing `?companyId=` instead would be
 * worse than either: the server answers `i.CompanyId == companyId`, which drops the
 * global rows, i.e. exactly the shipped library the picker exists to offer.
 *
 * `companyId` null means "no company chosen yet"; nothing is offered, because there
 * is no tenant to scope to and offering the global rows alone would silently narrow
 * the library rather than say a company is missing.
 */
export function visibleToCompany<T extends CompanyOwned>(
  rows: readonly T[],
  companyId: string | null,
): T[] {
  if (companyId === null) return []
  return rows.filter((row) => row.companyId === null || row.companyId === companyId)
}

/** A category with the depth it sits at, so a flat control can render a tree. */
export interface CategoryNode {
  category: QuestionCategory
  depth: number
}

/**
 * Depth-first flattening of the category forest, parents before their children.
 *
 * A category whose parent is not in `categories` is treated as a ROOT rather than
 * dropped. The server refuses to create a cycle and refuses a cross-tenant parent,
 * but a filtered list can still hide a parent from a child — and a subtree that
 * silently vanishes from a picker is the failure `UpdateCategoryAsync`'s cycle guard
 * exists to prevent, reintroduced on the client.
 */
export function flattenCategories(categories: readonly QuestionCategory[]): CategoryNode[] {
  const present = new Set(categories.map((category) => category.id))
  const byParent = new Map<string, QuestionCategory[]>()
  for (const category of categories) {
    const parent =
      category.parentCategoryId !== null && present.has(category.parentCategoryId)
        ? category.parentCategoryId
        : ''
    const siblings = byParent.get(parent)
    if (siblings) siblings.push(category)
    else byParent.set(parent, [category])
  }

  const nodes: CategoryNode[] = []
  // Defensive: the server walks to the root and refuses a cycle, but a cycle that
  // arrives anyway must not hang the browser rendering it.
  const seen = new Set<string>()

  function walk(parent: string, depth: number): void {
    for (const category of byParent.get(parent) ?? []) {
      if (seen.has(category.id)) continue
      seen.add(category.id)
      nodes.push({ category, depth })
      walk(category.id, depth + 1)
    }
  }

  walk('', 0)
  return nodes
}

/**
 * `id` and every category beneath it.
 *
 * Filtering on the exact id alone is the obvious implementation and the wrong one: a
 * library organised as "Leadership > Trust in leadership" would answer an admin who
 * picked *Leadership* with nothing at all, because every item is filed on a leaf.
 */
export function categoryWithDescendants(
  categories: readonly QuestionCategory[],
  id: string,
): Set<string> {
  const children = new Map<string, string[]>()
  for (const category of categories) {
    if (category.parentCategoryId === null) continue
    const siblings = children.get(category.parentCategoryId)
    if (siblings) siblings.push(category.id)
    else children.set(category.parentCategoryId, [category.id])
  }

  const result = new Set<string>()
  const queue = [id]
  while (queue.length > 0) {
    const current = queue.pop()!
    if (result.has(current)) continue
    result.add(current)
    queue.push(...(children.get(current) ?? []))
  }
  return result
}

export interface LibraryFilter {
  /** Free text. Empty means no text filter. */
  search: string
  /** A category id, or `null` for every category. */
  categoryId: string | null
  /** The full category list, needed to resolve `categoryId` to its subtree. */
  categories: readonly QuestionCategory[]
  /** The question types the destination surface can render. */
  allowedTypes: readonly string[]
}

/**
 * Everything an admin should be offered, in the order the server returned it.
 *
 * Search runs on the client because the list endpoint has no text parameter — its
 * filters are `categoryId`, `type`, `dimension`, `tag` and `companyId`. That is a
 * deliberate trade for a corpus this size (one fetch, instant typing) and is the one
 * thing here that would have to change if the library grows past a few thousand
 * rows; the seam is this function, not the component.
 *
 * `isActive: false` rows are dropped. Deactivating a library item is how an author
 * retires it, and a retired question that can still be picked is a retirement that
 * did nothing.
 */
export function filterLibraryItems(
  items: readonly QuestionLibraryItem[],
  filter: LibraryFilter,
): QuestionLibraryItem[] {
  const allowed = new Set(filter.allowedTypes)
  const scope =
    filter.categoryId === null
      ? null
      : categoryWithDescendants(filter.categories, filter.categoryId)
  const needles = foldForSearch(filter.search).split(/\s+/).filter((word) => word !== '')

  return items.filter((item) => {
    if (!item.isActive) return false
    if (!allowed.has(item.type)) return false
    if (scope !== null && !scope.has(item.questionCategoryId)) return false
    if (needles.length === 0) return true

    // Both languages, the tags and the dimension. An admin searching a bilingual
    // library should not have to know which language a question was filed under, and
    // the tags are the only place a synonym ever lives.
    const haystack = foldForSearch(
      [item.textEn, item.textEs, item.dimension ?? '', ...item.tags].join(' '),
    )
    return needles.every((needle) => haystack.includes(needle))
  })
}
