import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../api/authFetch'
import { createTranslator, type Messages } from '../../../i18n/translate'
import es from '../../../i18n/es.json'
import en from '../../../i18n/en.json'
import { describeNotAuthorized, normaliseEmail, notAuthorizedOf, parseAuthorizedPaste } from './authorizedList'

const tEs = createTranslator(es as Messages, en as Messages)

describe('reading a pasted list', () => {
  it('takes one address per line, with the name beside it when Excel or a CSV carries one', () => {
    const { entries, unreadable } = parseAuthorizedPaste(
      'Correo\tNombre\r\nana.perez@cliente.com\tAna Pérez\n\n  "Bea Solís", bea@cliente.com \ncarlos@cliente.com\n<dani@cliente.com>;Dani\n',
    )
    expect(entries).toEqual([
      { email: 'ana.perez@cliente.com', displayName: 'Ana Pérez' },
      { email: 'bea@cliente.com', displayName: 'Bea Solís' },
      { email: 'carlos@cliente.com' },
      { email: 'dani@cliente.com', displayName: 'Dani' },
    ])
    // The header row is said, not dropped in silence; the blank line is nothing.
    expect(unreadable).toEqual(['Correo\tNombre'])
  })

  it('matches as the server stores an address: trimmed and lower-cased', () => {
    expect(normaliseEmail('  Ana.Perez@Cliente.COM ')).toBe('ana.perez@cliente.com')
  })
})

describe('the refusal every send can meet', () => {
  const refusal = new ApiError(409, 'English, never shown', 'survey_recipient_not_authorized', {
    code: 'survey_recipient_not_authorized',
    notAuthorized: [
      { userId: 'u1', email: 'bea@cliente.com', name: 'Bea Solís' },
      { userId: 'u2', email: 'carlos@cliente.com', name: null },
    ],
  })

  it('names each person the API named, in the reader’s language', () => {
    expect(notAuthorizedOf(refusal)).toEqual([
      { userId: 'u1', email: 'bea@cliente.com', name: 'Bea Solís' },
      { userId: 'u2', email: 'carlos@cliente.com', name: null },
    ])
    const sentence = describeNotAuthorized(refusal, tEs)!
    expect(sentence).toContain('Bea Solís (bea@cliente.com)')
    expect(sentence).toContain('carlos@cliente.com')
    expect(sentence).toContain('lista autorizada del cliente')
    expect(sentence).not.toContain('English')
  })

  it('is nothing for any other refusal, so the caller’s own sentence stands', () => {
    expect(describeNotAuthorized(new ApiError(409, 'x', 'personal_link_not_in_audience'), tEs)).toBeNull()
    expect(describeNotAuthorized(new Error('x'), tEs)).toBeNull()
  })

  it('says «y n más» past ten names rather than printing six hundred', () => {
    const many = new ApiError(409, 'x', 'survey_recipient_not_authorized', {
      notAuthorized: Array.from({ length: 13 }, (_, i) => ({ userId: `u${i}`, email: `p${i}@c.com`, name: null })),
    })
    const sentence = describeNotAuthorized(many, tEs)!
    expect(sentence).toContain('p9@c.com')
    expect(sentence).not.toContain('p10@c.com')
    expect(sentence).toContain('y 3 más')
  })
})
