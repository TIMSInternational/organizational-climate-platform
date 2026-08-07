import { describe, it, expect } from 'vitest'
import {
  MINIMUM_RESPONDENTS,
  MINIMUM_WORD_OCCURRENCES,
  participationPercent,
  suppressWordCloud,
} from './microclimatePrivacy'
import type { WordCloudEntry } from './api/microclimates'

function word(text: string, value: number, language = 'en'): WordCloudEntry {
  return { text, value, language }
}

describe('suppressWordCloud', () => {
  it('withholds the whole cloud below the session floor, and says how much', () => {
    // The failure this prevents: two people answer, and an admin who knows the team
    // reads back what each of them typed. Returning an empty list with no count
    // would read as "nobody wrote anything", which is a different fact.
    const result = suppressWordCloud([word('visa', 3), word('rota', 2)], MINIMUM_RESPONDENTS - 1)

    expect(result.isSuppressed).toBe(true)
    expect(result.words).toEqual([])
    expect(result.withheldCount).toBe(2)
  })

  it('shows the cloud at exactly the floor', () => {
    const result = suppressWordCloud([word('workload', 4)], MINIMUM_RESPONDENTS)

    expect(result.isSuppressed).toBe(false)
    expect(result.words.map((w) => w.text)).toEqual(['workload'])
  })

  it('drops words below the occurrence floor and reports the count', () => {
    const result = suppressWordCloud(
      [word('workload', 4), word('visa', MINIMUM_WORD_OCCURRENCES - 1), word('rota', 2)],
      10,
    )

    expect(result.words.map((w) => w.text)).toEqual(['workload', 'rota'])
    expect(result.withheldCount).toBe(1)
  })

  it('keeps the two languages apart rather than merging them', () => {
    // `CountWordFrequencies` keys on (language, word) precisely so "work" and
    // "trabajo" are not one bar. Suppression must not undo that by de-duplicating
    // on text.
    const result = suppressWordCloud([word('work', 3, 'en'), word('trabajo', 3, 'es')], 10)

    expect(result.words).toHaveLength(2)
  })

  it('reports zero withheld when nothing was dropped', () => {
    const result = suppressWordCloud([word('workload', 4)], 10)
    expect(result.withheldCount).toBe(0)
  })
})

describe('participationPercent', () => {
  it('returns null rather than zero when there is no target', () => {
    // A rate over an invented denominator is worse than no rate: it reads as "0%
    // participation" when the truth is "nobody said how many people were invited".
    expect(participationPercent(4, 0)).toBeNull()
  })

  it('computes the rate against the target', () => {
    expect(participationPercent(12, 40)).toBeCloseTo(30)
  })

  it('does not cap above the target, because over-response is real', () => {
    // An anonymous link can be answered by more people than were expected. Clamping
    // to 100% would hide that the target was wrong.
    expect(participationPercent(50, 40)).toBeCloseTo(125)
  })
})
