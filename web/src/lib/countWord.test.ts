import { describe, expect, it } from 'vitest'
import { countWord } from './countWord'
import es from '../i18n/es.json'
import en from '../i18n/en.json'

/** A `t` over one catalogue, enough to resolve the `dashboard.next.countWord.*` keys. */
function tFor(catalogue: Record<string, unknown>) {
  return (key: string) => {
    const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue)
    return typeof value === 'string' ? value : key
  }
}

describe('countWord', () => {
  it('spells two to ten in the reader’s language, as the canvas writes a count inside a sentence', () => {
    expect(countWord(tFor(es), 5, 'es')).toBe('cinco')
    expect(countWord(tFor(es), 6, 'es')).toBe('seis')
    expect(countWord(tFor(en), 5, 'en')).toBe('five')
    for (let count = 2; count <= 10; count += 1) {
      expect(countWord(tFor(es), count, 'es')).toBe(es.dashboard.next.countWord[String(count) as keyof typeof es.dashboard.next.countWord])
    }
  })

  it('prints any other count as the numeral, never a key or a guessed word', () => {
    expect(countWord(tFor(es), 1, 'es')).toBe('1')
    expect(countWord(tFor(es), 0, 'es')).toBe('0')
    expect(countWord(tFor(es), 11, 'es')).toBe('11')
    expect(countWord(tFor(es), 1200, 'es')).toBe((1200).toLocaleString('es'))
    expect(countWord(tFor(es), 2.5, 'es')).toBe((2.5).toLocaleString('es'))
  })
})
