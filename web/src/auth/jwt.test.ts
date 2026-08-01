import { describe, it, expect } from 'vitest'
import { decodeJwtPayload } from './jwt'

function makeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  return `${header}.${body}.signature`
}

describe('decodeJwtPayload', () => {
  it('decodes a well-formed token payload', () => {
    const token = makeToken({ sub: 'user-1', role: 'company_admin', companyId: 'company-1' })
    expect(decodeJwtPayload(token)).toEqual({ sub: 'user-1', role: 'company_admin', companyId: 'company-1' })
  })

  it('handles base64url-encoded payloads (- and _ instead of + and /)', () => {
    // Force a payload whose base64 encoding contains + and / so we can verify the
    // -/_ substitution round-trips correctly.
    const payload = { role: 'employee', note: '???>>>' }
    const token = makeToken(payload)
    expect(decodeJwtPayload(token)).toEqual(payload)
  })

  it('returns null for a malformed token', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull()
    expect(decodeJwtPayload('a.b')).toBeNull()
    expect(decodeJwtPayload('a.b.c.d')).toBeNull()
  })

  it('returns null when the payload segment is not valid base64/JSON', () => {
    expect(decodeJwtPayload('header.not-valid-base64!!!.signature')).toBeNull()
  })
})
