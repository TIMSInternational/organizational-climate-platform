import { describe, it, expect } from 'vitest'
import { promiseMadeAtEntry } from './respondPromise'

const anonymousDefault = { anonymous: true, respondentIntro: null, asksParticipantIdentity: false }

describe('promiseMadeAtEntry', () => {
  it('is false on a route with no start page', () => {
    expect(promiseMadeAtEntry(undefined, anonymousDefault)).toBe(false)
  })

  it('is true after the share-link entry card, which draws from the same respond view', () => {
    expect(promiseMadeAtEntry('respondView', anonymousDefault)).toBe(true)
    expect(promiseMadeAtEntry('respondView', { ...anonymousDefault, respondentIntro: 'Propio' })).toBe(true)
    expect(promiseMadeAtEntry('respondView', { ...anonymousDefault, asksParticipantIdentity: true })).toBe(true)
  })

  it('is true after an invitation card that drew the same default wording', () => {
    expect(promiseMadeAtEntry({ invitation: true }, anonymousDefault)).toBe(true)
    expect(promiseMadeAtEntry({ invitation: true }, { ...anonymousDefault, respondentIntro: '   ' })).toBe(true)
    expect(promiseMadeAtEntry({ invitation: false }, { ...anonymousDefault, anonymous: false })).toBe(true)
  })

  it('ignores the intro and the participation clause on an identified response, as the block does', () => {
    expect(
      promiseMadeAtEntry({ invitation: false }, { anonymous: false, respondentIntro: 'Propio', asksParticipantIdentity: true }),
    ).toBe(true)
  })

  it('is false when the invitation card and the response disagree on anonymity', () => {
    expect(promiseMadeAtEntry({ invitation: false }, anonymousDefault)).toBe(false)
    expect(promiseMadeAtEntry({ invitation: true }, { ...anonymousDefault, anonymous: false })).toBe(false)
  })

  it('is false when the form would say what the invitation card could not', () => {
    expect(promiseMadeAtEntry({ invitation: true }, { ...anonymousDefault, respondentIntro: 'Propio' })).toBe(false)
    expect(promiseMadeAtEntry({ invitation: true }, { ...anonymousDefault, asksParticipantIdentity: true })).toBe(false)
  })
})
