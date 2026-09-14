import { describe, it, expect } from 'vitest'
import type { AIInsight, AIInsightListItem } from '../../api/insights'
import { acknowledgerIds, defaultSelection, pickLine, priorityTone, reviewedOn, tallyInsights } from './insightsDerive'
import type { InsightRow } from './insightsModel'

function item(over: Partial<AIInsightListItem> = {}): AIInsightListItem {
  return { id: 'i1', companyId: 'c1', type: 'risk', category: 'engagement', title: 'T', priority: 'high', isAcknowledged: false, ...over }
}

function detail(over: Partial<AIInsight> = {}): AIInsight {
  return {
    id: 'i1',
    surveyId: null,
    companyId: 'c1',
    departmentId: null,
    type: 'risk',
    category: 'engagement',
    title: 'T',
    description: 'D',
    confidenceScore: 82,
    priority: 'high',
    affectedSegments: [],
    recommendedActions: [],
    isAcknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    ...over,
  }
}

describe('insights derive', () => {
  it('counts the headline from the rows: open, high or critical, critical, acknowledged', () => {
    const rows: InsightRow[] = [
      { item: item({ id: 'a', priority: 'critical' }), detail: null },
      { item: item({ id: 'b', priority: 'high', isAcknowledged: true }), detail: null },
      { item: item({ id: 'c', priority: 'low', isAcknowledged: true }), detail: null },
    ]
    const tally = tallyInsights(rows)
    expect([tally.total, tally.open, tally.high, tally.critical, tally.acknowledged]).toEqual([3, 1, 2, 1, 2])
  })

  it('names the latest acknowledgement from the details, and whether one person made them all', () => {
    const same = tallyInsights([
      { item: item({ id: 'a', isAcknowledged: true }), detail: detail({ id: 'a', isAcknowledged: true, acknowledgedBy: 'u1', acknowledgedAt: '2026-08-13T15:00:00Z' }) },
      { item: item({ id: 'b', isAcknowledged: true }), detail: detail({ id: 'b', isAcknowledged: true, acknowledgedBy: 'u1', acknowledgedAt: '2026-08-12T15:00:00Z' }) },
    ])
    expect(same.latest).toEqual({ by: 'u1', at: '2026-08-13T15:00:00Z' })
    expect(same.oneAcknowledger).toBe(true)
    const two = tallyInsights([
      { item: item({ id: 'a', isAcknowledged: true }), detail: detail({ isAcknowledged: true, acknowledgedBy: 'u1', acknowledgedAt: '2026-08-13T15:00:00Z' }) },
      { item: item({ id: 'b', isAcknowledged: true }), detail: detail({ isAcknowledged: true, acknowledgedBy: 'u2', acknowledgedAt: '2026-08-14T15:00:00Z' }) },
    ])
    expect(two.latest?.by).toBe('u2')
    expect(two.oneAcknowledger).toBe(false)
  })

  it('claims no date it was not given', () => {
    const tally = tallyInsights([{ item: item({ isAcknowledged: true }), detail: detail({ isAcknowledged: true }) }])
    expect(tally.latest).toBeNull()
  })

  it('opens the most serious finding still waiting for review, else the most serious reviewed one', () => {
    expect(defaultSelection([item({ id: 'a', isAcknowledged: true }), item({ id: 'b' })])).toBe('b')
    expect(defaultSelection([item({ id: 'a', isAcknowledged: true }), item({ id: 'b', isAcknowledged: true })])).toBe('a')
    expect(defaultSelection([])).toBeNull()
    // An open critical outranks an open high, and any open one outranks a reviewed critical.
    expect(defaultSelection([item({ id: 'h' }), item({ id: 'c', priority: 'critical' })])).toBe('c')
    expect(defaultSelection([item({ id: 'rc', priority: 'critical', isAcknowledged: true }), item({ id: 'l', priority: 'low' })])).toBe('l')
  })

  it('opens Acme\'s risk over its trend at the same priority, both reviewed — as the SuperAIInsightsSelected artboard does', () => {
    const acme = [
      item({ id: 'sales', type: 'trend', priority: 'high', isAcknowledged: true, title: 'Engagement is trending down in Sales' }),
      item({ id: 'engineering', type: 'risk', priority: 'high', isAcknowledged: true, title: 'Engagement dipped in Engineering' }),
    ]
    expect(defaultSelection(acme)).toBe('engineering')
  })

  it('dates a company\'s reviews from the details: the latest, and whether they share its day', () => {
    const at = (iso: string) => detail({ isAcknowledged: true, acknowledgedAt: iso })
    expect(reviewedOn([at('2026-08-13T15:42:10Z'), at('2026-08-13T15:42:10Z')])).toEqual({ latest: '2026-08-13T15:42:10Z', sameDay: true })
    expect(reviewedOn([at('2026-08-12T09:00:00Z'), at('2026-08-13T15:42:10Z')])).toEqual({ latest: '2026-08-13T15:42:10Z', sameDay: false })
    // A detail that could not be read, or one with no date, dates nothing.
    expect(reviewedOn([at('2026-08-13T15:42:10Z'), null])).toBeNull()
    expect(reviewedOn([detail({ isAcknowledged: true })])).toBeNull()
    expect(reviewedOn([])).toBeNull()
  })

  it('draws critical red, high amber, the rest quiet', () => {
    expect([priorityTone('critical'), priorityTone('high'), priorityTone('medium'), priorityTone('whatever')]).toEqual([
      'critical',
      'warning',
      'neutral',
      'neutral',
    ])
  })

  it('says what each company holds on the choose card — and that an unreadable list is not "none"', () => {
    expect(pickLine({ id: 'c', name: 'C', insights: null, surveys: 3 })).toEqual({ kind: 'unreadable' })
    expect(pickLine({ id: 'c', name: 'C', insights: { total: 0, acknowledged: 0 }, surveys: 0 })).toEqual({ kind: 'nothing' })
    expect(pickLine({ id: 'c', name: 'C', insights: { total: 0, acknowledged: 0 }, surveys: 4 })).toEqual({ kind: 'no-insights' })
    expect(pickLine({ id: 'c', name: 'C', insights: { total: 2, acknowledged: 2 }, surveys: 4 })).toEqual({
      kind: 'all-acknowledged',
      total: 2,
      on: null,
      sameDay: true,
    })
    expect(
      pickLine({ id: 'c', name: 'C', insights: { total: 2, acknowledged: 2 }, surveys: 4, reviewed: { latest: '2026-08-13T15:42:10Z', sameDay: true } }),
    ).toEqual({ kind: 'all-acknowledged', total: 2, on: '2026-08-13T15:42:10Z', sameDay: true })
    expect(pickLine({ id: 'c', name: 'C', insights: { total: 3, acknowledged: 0 }, surveys: 4 })).toEqual({ kind: 'none-acknowledged', total: 3 })
    expect(pickLine({ id: 'c', name: 'C', insights: { total: 3, acknowledged: 1 }, surveys: 4 })).toEqual({
      kind: 'some-acknowledged',
      total: 3,
      acknowledged: 1,
    })
  })

  it('looks each acknowledger up once', () => {
    const rows: InsightRow[] = [
      { item: item({ id: 'a' }), detail: detail({ acknowledgedBy: 'u1' }) },
      { item: item({ id: 'b' }), detail: detail({ acknowledgedBy: 'u1' }) },
      { item: item({ id: 'c' }), detail: detail({ acknowledgedBy: null }) },
      { item: item({ id: 'd' }), detail: null },
    ]
    expect(acknowledgerIds(rows)).toEqual(['u1'])
  })
})
