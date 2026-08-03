import { describe, it, expect } from 'vitest'
import { createTranslator } from './translate'
import type { Messages } from './translate'

const en: Messages = {
  common: { save: 'Save', nested: { deep: 'Deep' } },
  greeting: 'Hello {name}, you have {count} messages',
  onlyInEnglish: 'Fallback value',
}

const es: Messages = {
  common: { save: 'Guardar', nested: { deep: 'Profundo' } },
  greeting: 'Hola {name}, tienes {count} mensajes',
}

describe('createTranslator', () => {
  it('resolves a dot path', () => {
    expect(createTranslator(en)('common.save')).toBe('Save')
    expect(createTranslator(en)('common.nested.deep')).toBe('Deep')
  })

  it('returns the key itself when there is no translation', () => {
    expect(createTranslator(en)('nope.missing')).toBe('nope.missing')
  })

  it('returns the key when the path stops on a subtree rather than a leaf', () => {
    // `common` is an object. Rendering "[object Object]" would be worse than
    // showing the key.
    expect(createTranslator(en)('common')).toBe('common')
  })

  it('interpolates named params', () => {
    expect(createTranslator(en)('greeting', { name: 'Ana', count: 3 })).toBe(
      'Hello Ana, you have 3 messages',
    )
  })

  it('leaves an unsupplied placeholder visible rather than blanking it', () => {
    expect(createTranslator(en)('greeting', { name: 'Ana' })).toBe(
      'Hello Ana, you have {count} messages',
    )
  })

  it('interpolates a zero without dropping it', () => {
    // A falsy-but-present param must still substitute.
    expect(createTranslator(en)('greeting', { name: 'Ana', count: 0 })).toBe(
      'Hello Ana, you have 0 messages',
    )
  })

  it('falls back to the fallback catalogue for a key the locale lacks', () => {
    const t = createTranslator(es, en)
    expect(t('onlyInEnglish')).toBe('Fallback value')
  })

  it('prefers the active locale over the fallback', () => {
    const t = createTranslator(es, en)
    expect(t('common.save')).toBe('Guardar')
  })

  it('returns the key when neither catalogue has it', () => {
    expect(createTranslator(es, en)('absent.everywhere')).toBe('absent.everywhere')
  })

  it('does not resolve inherited Object properties as translations', () => {
    // `'constructor' in {}` is true via the prototype chain, so a naive `in`
    // check would treat it as a hit and walk into Object internals.
    expect(createTranslator(en)('constructor')).toBe('constructor')
    expect(createTranslator(en)('common.toString')).toBe('common.toString')
  })
})
