import { describe, it, expect } from 'vitest'
import type { QuestionBankItem, QuestionBankMetrics } from '../../api/questionBank'
import type { QuestionCategory, QuestionLibraryItem } from '../../api/questionLibrary'
import {
  OWNER_ALL,
  OWNER_GLOBAL,
  askedAnsweredSkipped,
  canWriteRow,
  filterByOwner,
  librarySummary,
  needsAttention,
} from './bankDerive'

function row(over: Partial<QuestionBankItem> = {}): QuestionBankItem {
  return {
    id: 'q1',
    companyId: null,
    text: 'Me siento parte del equipo',
    language: 'es',
    type: 'likert',
    category: 'Pertenencia',
    subcategory: null,
    industry: null,
    companySize: null,
    usageCount: 0,
    responseRate: 0,
    insightScore: 0,
    lastUsedAt: null,
    isActive: true,
    isAiGenerated: false,
    version: 1,
    parentQuestionBankItemId: null,
    tags: [],
    ...over,
  }
}

function metrics(over: Partial<QuestionBankMetrics> = {}): QuestionBankMetrics {
  return {
    questionBankItemId: 'q1',
    surveysUsedIn: 1,
    questionsCreated: 1,
    timesAsked: 40,
    timesAnswered: 30,
    responseRate: 75,
    skipRate: 25,
    averageTimeSpentSeconds: null,
    lastUsedAt: null,
    ...over,
  }
}

describe('question bank derive', () => {
  it('narrows by owner and never widens: every row, global rows, or one company', () => {
    const rows = [row({ id: 'g' }), row({ id: 'a', companyId: 'acme' }), row({ id: 'm', companyId: 'meridiano' })]
    expect(filterByOwner(rows, OWNER_ALL).map((r) => r.id)).toEqual(['g', 'a', 'm'])
    expect(filterByOwner(rows, OWNER_GLOBAL).map((r) => r.id)).toEqual(['g'])
    expect(filterByOwner(rows, 'acme').map((r) => r.id)).toEqual(['a'])
  })

  it('counts the library\'s active global corpus for the split card', () => {
    const category = (companyId: string | null, isActive = true) => ({ id: 'c', companyId, isActive }) as QuestionCategory
    const item = (companyId: string | null, isActive = true) => ({ id: 'i', companyId, isActive }) as QuestionLibraryItem
    expect(
      librarySummary(
        [category(null), category(null), category('acme'), category(null, false)],
        [item(null), item(null), item(null), item('acme'), item(null, false)],
      ),
    ).toEqual({ questions: 3, categories: 2 })
  })

  it('prints asked, answered and skipped from the metrics, and a dash — never zero — without them', () => {
    expect(askedAnsweredSkipped(metrics())).toEqual({ asked: 40, answered: 30, skipped: 10 })
    expect(askedAnsweredSkipped(undefined)).toBeNull()
  })

  it('flags a question people skip only once it has been asked enough, and never a retired one', () => {
    expect(needsAttention(row(), metrics({ timesAsked: 40, responseRate: 40 }))).toBe(true)
    expect(needsAttention(row(), metrics({ timesAsked: 4, responseRate: 10 }))).toBe(false)
    expect(needsAttention(row({ isActive: false }), metrics({ timesAsked: 400, responseRate: 5 }))).toBe(false)
    expect(needsAttention(row(), undefined)).toBe(false)
  })

  it('lets a super administrator write any row and a company administrator only their own, never a global one', () => {
    const superAdmin = { role: 'super_admin', companyId: undefined }
    const companyAdmin = { role: 'company_admin', companyId: 'acme' }
    expect(canWriteRow({ companyId: null }, superAdmin)).toBe(true)
    expect(canWriteRow({ companyId: 'meridiano' }, superAdmin)).toBe(true)
    expect(canWriteRow({ companyId: 'acme' }, companyAdmin)).toBe(true)
    expect(canWriteRow({ companyId: null }, companyAdmin)).toBe(false)
    expect(canWriteRow({ companyId: 'meridiano' }, companyAdmin)).toBe(false)
    expect(canWriteRow({ companyId: 'acme' }, { role: 'leader', companyId: 'acme' })).toBe(false)
  })
})
