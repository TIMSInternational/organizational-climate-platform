import { describe, it, expect } from 'vitest'
import { pickPrivacyNotice } from './privacyNotice'

describe('pickPrivacyNotice', () => {
  const both = { privacyNoticeEs: 'Aviso', privacyNoticeEn: 'Notice' }

  it('gives the respondent their own language first', () => {
    expect(pickPrivacyNotice(both, 'es')).toBe('Aviso')
    expect(pickPrivacyNotice(both, 'en')).toBe('Notice')
    expect(pickPrivacyNotice(both, 'en-US')).toBe('Notice')
  })

  it('falls back to the other language when only that one is set', () => {
    expect(pickPrivacyNotice({ privacyNoticeEs: null, privacyNoticeEn: 'Notice' }, 'es')).toBe('Notice')
    expect(pickPrivacyNotice({ privacyNoticeEs: 'Aviso', privacyNoticeEn: null }, 'en')).toBe('Aviso')
  })

  it('is null when neither is set — absent, null or blank', () => {
    expect(pickPrivacyNotice({}, 'es')).toBeNull()
    expect(pickPrivacyNotice({ privacyNoticeEs: null, privacyNoticeEn: null }, 'en')).toBeNull()
    expect(pickPrivacyNotice({ privacyNoticeEs: '  \n ', privacyNoticeEn: '' }, 'es')).toBeNull()
  })

  it('treats a blank in the respondent’s language as unset, and falls back past it', () => {
    expect(pickPrivacyNotice({ privacyNoticeEs: ' ', privacyNoticeEn: 'Notice' }, 'es')).toBe('Notice')
  })

  it('returns the text exactly as stored, line breaks included', () => {
    expect(pickPrivacyNotice({ privacyNoticeEs: 'Uno\n\nDos' }, 'es')).toBe('Uno\n\nDos')
  })
})
