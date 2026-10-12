import { describe, it, expect } from 'vitest'
import { byCount } from './plural'
import { createTranslator, CATALOGUES } from './index'
import { daysNote } from '../features/dashboard/next/team/format'

const es = createTranslator(CATALOGUES.es)
const en = createTranslator(CATALOGUES.en)

describe('byCount', () => {
  it('picks the One key for exactly 1 and the other key for every other count, 0 included', () => {
    expect(byCount(1, 'a.xOne', 'a.x')).toBe('a.xOne')
    expect(byCount(0, 'a.xOne', 'a.x')).toBe('a.x')
    expect(byCount(2, 'a.xOne', 'a.x')).toBe('a.x')
    expect(byCount(-1, 'a.xOne', 'a.x')).toBe('a.x')
  })

  it('makes the survey question count agree in both languages', () => {
    const say = (t: typeof es, n: number) =>
      t(byCount(n, 'surveys.reviewQuestionCountOne', 'surveys.reviewQuestionCount'), { count: n })
    expect(say(es, 1)).toBe('1 pregunta')
    expect(say(es, 6)).toBe('6 preguntas')
    expect(say(es, 0)).toBe('0 preguntas')
    expect(say(en, 1)).toBe('1 question')
    expect(say(en, 6)).toBe('6 questions')
  })
})

describe('a days-ago line', () => {
  it('says "vencido hace 1 día", never "hace 1 días", and keeps the plural for 2', () => {
    expect(daysNote(-1, es)).toBe('vencido hace 1 día')
    expect(daysNote(-2, es)).toBe('vencido hace 2 días')
    expect(daysNote(1, es)).not.toContain('1 días')
  })

  it('says a closed survey closed "hace 1 día" on the distribution screen', () => {
    const key = byCount(1, 'surveys.next.distribution.closedAgoOne', 'surveys.next.distribution.closedAgo')
    expect(es(key, { days: 1 })).toBe('hace 1 día')
    expect(en(key, { days: 1 })).toBe('1 day ago')
  })
})
