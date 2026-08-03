import { describe, it, expect } from 'vitest'
import { CATALOGUES, LOCALES } from './locale'
import type { Messages, MessageNode } from './translate'

/** Every leaf path in a catalogue, as `a.b.c`. */
function leafPaths(node: MessageNode, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix]
  return Object.entries(node).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  )
}

function paths(messages: Messages): string[] {
  return leafPaths(messages as MessageNode).sort()
}

describe('message catalogues', () => {
  it('ships every locale listed in LOCALES', () => {
    for (const locale of LOCALES) {
      expect(CATALOGUES[locale], `missing catalogue for ${locale}`).toBeTruthy()
    }
  })

  /**
   * The legacy catalogues drifted: `en.json` had 8 `surveys.*` keys that `es.json`
   * did not, so a Spanish user hit English text. This test is the guard against
   * that recurring — add a key to one locale and it fails until the other catches
   * up.
   */
  it('keeps every locale at exact key parity', () => {
    const reference = paths(CATALOGUES.en)

    for (const locale of LOCALES) {
      const actual = paths(CATALOGUES[locale])
      const missing = reference.filter((key) => !actual.includes(key))
      const extra = actual.filter((key) => !reference.includes(key))

      expect(missing, `${locale} is missing keys present in en`).toEqual([])
      expect(extra, `${locale} has keys absent from en`).toEqual([])
    }
  })

  it('has no empty or whitespace-only translations', () => {
    for (const locale of LOCALES) {
      const blanks = paths(CATALOGUES[locale]).filter((key) => {
        const value = key
          .split('.')
          .reduce<MessageNode | undefined>(
            (node, segment) =>
              typeof node === 'object' && node !== null ? node[segment] : undefined,
            CATALOGUES[locale] as MessageNode,
          )
        return typeof value === 'string' && value.trim() === ''
      })
      expect(blanks, `${locale} has blank translations`).toEqual([])
    }
  })

  it('uses the same interpolation placeholders across locales', () => {
    // A translation that drops `{count}` silently loses data at runtime.
    const placeholders = (locale: (typeof LOCALES)[number], key: string): string[] => {
      const value = key
        .split('.')
        .reduce<MessageNode | undefined>(
          (node, segment) => (typeof node === 'object' && node !== null ? node[segment] : undefined),
          CATALOGUES[locale] as MessageNode,
        )
      return typeof value === 'string' ? [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : []
    }

    const mismatches: string[] = []
    for (const key of paths(CATALOGUES.en)) {
      const reference = placeholders('en', key)
      for (const locale of LOCALES) {
        if (locale === 'en') continue
        const actual = placeholders(locale, key)
        if (reference.join(',') !== actual.join(',')) {
          mismatches.push(`${key}: en={${reference}} ${locale}={${actual}}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})
