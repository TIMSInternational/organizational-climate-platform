import { describe, it, expect } from 'vitest'
import type {
  QuestionCategory,
  QuestionLibraryItem,
} from '../../features/questions/api/questionLibrary'
import {
  categoryWithDescendants,
  filterLibraryItems,
  flattenCategories,
  foldForSearch,
  visibleToCompany,
} from './questionLibraryFilter'

const OWN = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

function category(overrides: Partial<QuestionCategory> & { id: string }): QuestionCategory {
  return {
    companyId: null,
    parentCategoryId: null,
    nameEn: overrides.id,
    nameEs: overrides.id,
    descriptionEn: null,
    descriptionEs: null,
    order: 0,
    icon: null,
    color: null,
    isActive: true,
    itemCount: 0,
    ...overrides,
  }
}

function item(overrides: Partial<QuestionLibraryItem> & { id: string }): QuestionLibraryItem {
  return {
    companyId: null,
    questionCategoryId: 'root',
    textEn: 'How safe do you feel speaking up?',
    textEs: '¿Qué tan seguro te sientes al hablar?',
    type: 'likert',
    dimension: null,
    usageCount: 0,
    lastUsedAt: null,
    isActive: true,
    version: 1,
    tags: [],
    ...overrides,
  }
}

const ALL_TYPES = ['likert', 'multiple_choice', 'open_ended', 'yes_no', 'rating']

function filter(
  items: QuestionLibraryItem[],
  overrides: Partial<Parameters<typeof filterLibraryItems>[1]> = {},
) {
  return filterLibraryItems(items, {
    search: '',
    categoryId: null,
    categories: [],
    allowedTypes: ALL_TYPES,
    ...overrides,
  })
}

describe('foldForSearch', () => {
  it('folds case and diacritics so a keyboard without accents can reach Spanish', () => {
    expect(foldForSearch('Comunicación')).toBe('comunicacion')
    expect(foldForSearch('¿QUÉ TAL?')).toBe('¿que tal?')
  })
})

describe('visibleToCompany', () => {
  it('offers the global rows and the destination company own rows', () => {
    const rows = [
      item({ id: 'global', companyId: null }),
      item({ id: 'mine', companyId: OWN }),
      item({ id: 'theirs', companyId: OTHER }),
    ]
    expect(visibleToCompany(rows, OWN).map((row) => row.id)).toEqual(['global', 'mine'])
  })

  it('never offers another tenant question, which is what a SuperAdmin would otherwise see', () => {
    // The list endpoint applies no company filter for a SuperAdmin, so the raw
    // response IS every tenant's library. Picking one company's question into
    // another company's survey is a cross-tenant content leak.
    const rows = [item({ id: 'theirs', companyId: OTHER })]
    expect(visibleToCompany(rows, OWN)).toEqual([])
  })

  it('offers nothing at all when no company has been chosen', () => {
    const rows = [item({ id: 'global', companyId: null }), item({ id: 'mine', companyId: OWN })]
    expect(visibleToCompany(rows, null)).toEqual([])
  })
})

describe('flattenCategories', () => {
  it('puts each child directly under its parent, one level deeper', () => {
    const categories = [
      category({ id: 'leadership' }),
      category({ id: 'trust', parentCategoryId: 'leadership' }),
      category({ id: 'workload' }),
    ]
    expect(flattenCategories(categories).map((node) => [node.category.id, node.depth])).toEqual([
      ['leadership', 0],
      ['trust', 1],
      ['workload', 0],
    ])
  })

  it('shows a category whose parent is missing rather than dropping it', () => {
    const categories = [category({ id: 'orphan', parentCategoryId: 'not-here' })]
    expect(flattenCategories(categories).map((node) => node.category.id)).toEqual(['orphan'])
  })

  it('terminates on a cycle instead of hanging the browser', () => {
    const categories = [
      category({ id: 'a', parentCategoryId: 'b' }),
      category({ id: 'b', parentCategoryId: 'a' }),
    ]
    expect(flattenCategories(categories).length).toBeLessThanOrEqual(2)
  })
})

describe('categoryWithDescendants', () => {
  it('reaches grandchildren, not just direct children', () => {
    const categories = [
      category({ id: 'root' }),
      category({ id: 'mid', parentCategoryId: 'root' }),
      category({ id: 'leaf', parentCategoryId: 'mid' }),
      category({ id: 'elsewhere' }),
    ]
    expect([...categoryWithDescendants(categories, 'root')].sort()).toEqual(['leaf', 'mid', 'root'])
  })
})

describe('filterLibraryItems', () => {
  const categories = [
    category({ id: 'leadership' }),
    category({ id: 'trust', parentCategoryId: 'leadership' }),
    category({ id: 'workload' }),
  ]

  it('shows a parent category items AND everything filed beneath it', () => {
    // A library organised as "Leadership > Trust in leadership" files every item on
    // a leaf. Matching the exact id alone answers an admin who picked Leadership
    // with nothing at all.
    const items = [
      item({ id: 'on-parent', questionCategoryId: 'leadership' }),
      item({ id: 'on-child', questionCategoryId: 'trust' }),
      item({ id: 'elsewhere', questionCategoryId: 'workload' }),
    ]
    expect(filter(items, { categoryId: 'leadership', categories }).map((row) => row.id)).toEqual([
      'on-parent',
      'on-child',
    ])
  })

  it('matches Spanish text, tags and the dimension, not only the English text', () => {
    const items = [
      item({ id: 'english', textEn: 'Workload is manageable', textEs: 'zzz' }),
      item({ id: 'spanish', textEn: 'zzz', textEs: 'La carga de trabajo es manejable' }),
      item({ id: 'tagged', textEn: 'zzz', textEs: 'zzz', tags: ['workload'] }),
      item({ id: 'dimension', textEn: 'zzz', textEs: 'zzz', dimension: 'workload' }),
      item({ id: 'unrelated', textEn: 'zzz', textEs: 'zzz' }),
    ]
    expect(filter(items, { search: 'workload' }).map((row) => row.id)).toEqual([
      'english',
      'tagged',
      'dimension',
    ])
    expect(filter(items, { search: 'carga' }).map((row) => row.id)).toEqual(['spanish'])
  })

  it('ignores accents in both the needle and the haystack', () => {
    const items = [item({ id: 'accented', textEs: 'Comunicación interna' })]
    expect(filter(items, { search: 'comunicacion' }).map((row) => row.id)).toEqual(['accented'])
    expect(filter(items, { search: 'COMUNICACIÓN' }).map((row) => row.id)).toEqual(['accented'])
  })

  it('requires every word of a multi-word search', () => {
    const items = [
      item({ id: 'both', textEn: 'trust in leadership' }),
      item({ id: 'one', textEn: 'trust in colleagues' }),
    ]
    expect(filter(items, { search: 'trust leadership' }).map((row) => row.id)).toEqual(['both'])
  })

  it('does not offer a retired item', () => {
    const items = [item({ id: 'retired', isActive: false }), item({ id: 'live' })]
    expect(filter(items).map((row) => row.id)).toEqual(['live'])
  })

  it('does not offer a type the destination cannot render', () => {
    const items = [item({ id: 'ranked', type: 'ranking' }), item({ id: 'likert' })]
    expect(filter(items, { allowedTypes: ['likert'] }).map((row) => row.id)).toEqual(['likert'])
  })
})
