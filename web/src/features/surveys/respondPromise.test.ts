import { describe, it, expect } from 'vitest'
import { invitationPromise, promiseMadeAtEntry, type EntryPromise } from './respondPromise'

const anonymousDefault = { anonymous: true, asksParticipantIdentity: false, resolvedLocale: 'es', content: {} }
const defaultCard = (invitation: boolean): EntryPromise => ({ invitation, locale: 'es', anonymousBody: null, anonymousChip: null })

describe('promiseMadeAtEntry', () => {
  it('is false on a route with no start page', () => {
    expect(promiseMadeAtEntry(undefined, anonymousDefault, 'es')).toBe(false)
  })

  it('is true after the share-link entry card, which draws from the same respond view', () => {
    expect(promiseMadeAtEntry('respondView', anonymousDefault, 'es')).toBe(true)
    expect(promiseMadeAtEntry('respondView', { ...anonymousDefault, content: { anonymousBody: 'Propio' } }, 'es')).toBe(true)
    expect(promiseMadeAtEntry('respondView', { ...anonymousDefault, asksParticipantIdentity: true }, 'es')).toBe(true)
  })

  it('is true after an invitation card that drew the same default wording', () => {
    expect(promiseMadeAtEntry(defaultCard(true), anonymousDefault, 'es')).toBe(true)
    expect(promiseMadeAtEntry(defaultCard(true), { ...anonymousDefault, content: { anonymousBody: '   ' } }, 'es')).toBe(true)
    expect(promiseMadeAtEntry(defaultCard(false), { ...anonymousDefault, anonymous: false }, 'es')).toBe(true)
  })

  /** The duplicate a company-level `anonymousBody` caused: the card drew it, and so would the form. */
  it('is true after an invitation card that drew the same client paragraph', () => {
    const detail = { anonymity: { anonymous: true }, resolvedLocale: 'es', content: { anonymousBody: 'Texto de la empresa' } }
    const view = { ...anonymousDefault, content: { anonymousBody: 'Texto de la empresa' } }
    expect(promiseMadeAtEntry(invitationPromise(detail, 'es'), view, 'es')).toBe(true)
  })

  it('ignores the client paragraph and the participation clause on an identified response, as the block does', () => {
    expect(
      promiseMadeAtEntry(defaultCard(false), { anonymous: false, asksParticipantIdentity: true, resolvedLocale: 'es', content: { anonymousBody: 'Propio' } }, 'es'),
    ).toBe(true)
  })

  it('is false when the invitation card and the response disagree on anonymity', () => {
    expect(promiseMadeAtEntry(defaultCard(false), anonymousDefault, 'es')).toBe(false)
    expect(promiseMadeAtEntry(defaultCard(true), { ...anonymousDefault, anonymous: false }, 'es')).toBe(false)
  })

  it('is false when the form would say what the invitation card did not', () => {
    expect(promiseMadeAtEntry(defaultCard(true), { ...anonymousDefault, content: { anonymousBody: 'Propio' } }, 'es')).toBe(false)
    expect(promiseMadeAtEntry(defaultCard(true), { ...anonymousDefault, content: { anonymousChip: 'Confidencial' } }, 'es')).toBe(false)
    expect(promiseMadeAtEntry(defaultCard(true), { ...anonymousDefault, asksParticipantIdentity: true }, 'es')).toBe(false)
    // The card drew in another language: it did not say these words.
    expect(promiseMadeAtEntry(defaultCard(true), anonymousDefault, 'en')).toBe(false)
  })
})

describe('invitationPromise', () => {
  it('records the client\'s words the card drew, or null for the catalogue\'s', () => {
    expect(invitationPromise({ anonymity: { anonymous: true }, resolvedLocale: 'es', content: { anonymousBody: 'Texto' } }, 'es'))
      .toEqual({ invitation: true, locale: 'es', anonymousBody: 'Texto', anonymousChip: null })
    // Another screen language: `effectiveText` draws the catalogue's, and so does the card.
    expect(invitationPromise({ anonymity: { anonymous: true }, resolvedLocale: 'es', content: { anonymousBody: 'Texto' } }, 'en'))
      .toEqual({ invitation: true, locale: 'en', anonymousBody: null, anonymousChip: null })
  })
})
