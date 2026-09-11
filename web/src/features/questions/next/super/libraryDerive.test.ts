import { describe, it, expect } from 'vitest'
import type { QuestionCategory, QuestionLibraryItemDetail } from '../../api/questionLibrary'
import {
  bothLanguages,
  canWriteLibraryRow,
  categoryName,
  categoryTree,
  copiesOf,
  createBody,
  draftFromDetail,
  updateBody,
} from './libraryDerive'

function category(id: string, companyId: string | null, nameEs: string, nameEn: string): QuestionCategory {
  return {
    id,
    companyId,
    parentCategoryId: null,
    nameEn,
    nameEs,
    descriptionEn: null,
    descriptionEs: null,
    order: 1,
    icon: null,
    color: null,
    isActive: true,
    itemCount: 2,
  }
}

/** A real detail's shape (`QuestionLibraryItemDetail`), with a scale, options and tags to lose. */
const DETAIL: QuestionLibraryItemDetail = {
  id: 'item-1',
  companyId: null,
  questionCategoryId: 'cat-feedback',
  textEn: 'My manager gives me useful feedback on my work.',
  textEs: 'Mi jefatura me da retroalimentación útil sobre mi trabajo.',
  type: 'likert',
  dimension: 'Liderazgo',
  usageCount: 0,
  lastUsedAt: null,
  isActive: true,
  version: 1,
  tags: ['feedback'],
  language: 'both',
  scaleMin: 1,
  scaleMax: 5,
  scaleLabelMinEn: 'Strongly disagree',
  scaleLabelMinEs: 'Muy en desacuerdo',
  scaleLabelMaxEn: 'Strongly agree',
  scaleLabelMaxEs: 'Muy de acuerdo',
  previousVersionId: null,
  createdAt: '2026-09-10T01:58:52Z',
  updatedAt: '2026-09-10T01:58:52Z',
  options: [],
}

describe('question library derive', () => {
  it('folds a tenant\'s copies of the global categories into one group and keeps its own apart', () => {
    const tree = categoryTree([
      category('g1', null, 'Retroalimentación', 'Feedback'),
      category('g2', null, 'Liderazgo', 'Leadership'),
      category('a1', 'acme', 'Retroalimentación', 'Feedback'),
      category('a2', 'acme', 'Liderazgo', 'Leadership'),
      category('a3', 'acme', 'Seguridad', 'Safety'),
    ])
    expect(tree.global.map((c) => c.id)).toEqual(['g1', 'g2'])
    expect(tree.tenants).toHaveLength(1)
    expect(tree.tenants[0].copies.map((c) => c.id)).toEqual(['a1', 'a2'])
    expect(tree.tenants[0].own.map((c) => c.id)).toEqual(['a3'])
  })

  it('finds a global category\'s tenant copies by both names', () => {
    const all = [
      category('g1', null, 'Retroalimentación', 'Feedback'),
      category('a1', 'acme', 'Retroalimentación', 'Feedback'),
      category('a9', 'acme', 'Retroalimentación', 'Recognition'),
    ]
    expect(copiesOf(all[0], all).map((c) => c.id)).toEqual(['a1'])
  })

  it('names a category in the reader\'s language', () => {
    const c = category('g1', null, 'Retroalimentación', 'Feedback')
    expect(categoryName(c, 'es')).toBe('Retroalimentación')
    expect(categoryName(c, 'en')).toBe('Feedback')
  })

  it('carries the detail\'s scale, labels, options and tags back on an edit — a PUT replaces them all', () => {
    const body = updateBody({ ...draftFromDetail(DETAIL), textEs: 'Mi jefatura me orienta.' })
    expect(body).toMatchObject({
      questionCategoryId: 'cat-feedback',
      textEs: 'Mi jefatura me orienta.',
      textEn: DETAIL.textEn,
      scaleMin: 1,
      scaleMax: 5,
      scaleLabelMinEs: 'Muy en desacuerdo',
      scaleLabelMaxEn: 'Strongly agree',
      dimension: 'Liderazgo',
      tags: ['feedback'],
    })
    // Immutable after creation: neither travels on an update.
    expect(body).not.toHaveProperty('type')
    expect(body).not.toHaveProperty('companyId')
  })

  it('creates a global row without a company id, and a company row with one', () => {
    const draft = draftFromDetail(DETAIL)
    expect(createBody(draft, undefined)).not.toHaveProperty('companyId')
    expect(createBody(draft, 'acme')).toMatchObject({ companyId: 'acme', type: 'likert' })
  })

  it('refuses whitespace as a translation', () => {
    expect(bothLanguages({ textEs: 'Hola', textEn: 'Hello' })).toBe(true)
    expect(bothLanguages({ textEs: '   ', textEn: 'Hello' })).toBe(false)
  })

  it('lets a company administrator write their own rows only — a global row is the super administrator\'s', () => {
    expect(canWriteLibraryRow({ companyId: null }, { role: 'super_admin', companyId: undefined })).toBe(true)
    expect(canWriteLibraryRow({ companyId: null }, { role: 'company_admin', companyId: 'acme' })).toBe(false)
    expect(canWriteLibraryRow({ companyId: 'acme' }, { role: 'company_admin', companyId: 'acme' })).toBe(true)
  })
})
