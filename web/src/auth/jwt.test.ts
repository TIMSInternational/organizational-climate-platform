import { describe, it, expect } from 'vitest'
import { decodeJwtPayload } from './jwt'

function makeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  return `${header}.${body}.signature`
}

/**
 * #375. The same thing, but encoded the way a real token is.
 *
 * `btoa` above throws outright on any character over U+00FF and silently Latin-1s the
 * ones below it, so the ASCII-only helper *cannot* build the token this bug is about.
 * The API writes its payload as UTF-8 bytes -- confirmed against
 * `JwtTokenService.IssueToken`, whose emitted payload is the literal bytes
 * `"name":"Mar\xc3\xada Herrera"` and not a `í` escape -- so the fixture has to
 * do the same or it proves nothing about production tokens.
 */
function makeUtf8Token(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  const body = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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

  // #375. The claim the shell renders on every screen -- the rail, the account menu and
  // the avatar initial all read `name` through this one decoder.
  it('decodes a UTF-8 name claim to exactly the string the API issued', () => {
    const token = makeUtf8Token({
      sub: 'user-1',
      role: 'company_admin',
      companyId: 'company-1',
      name: 'María Herrera',
    })

    const claims = decodeJwtPayload(token)

    expect(claims?.name).toBe('María Herrera')
    // Spelled out because the old decoder produced a string that *looks* close in a
    // terminal: `MarÃ­a`, where U+00AD is a soft hyphen and renders as nothing at all.
    expect(Array.from(String(claims?.name), (c) => c.codePointAt(0))).toEqual(
      Array.from('María Herrera', (c) => c.codePointAt(0)),
    )
    // The ASCII claims that decide routing and scoping are unchanged by the UTF-8 pass.
    expect(claims).toEqual({
      sub: 'user-1',
      role: 'company_admin',
      companyId: 'company-1',
      name: 'María Herrera',
    })
  })

  it('decodes every accented form this client actually uses', () => {
    // Costa Rican names, and the first letter matters as much as the rest: both
    // `ShellControls` and `SidebarUserMenu` take `charAt(0)` for the avatar initial, so a
    // mangled `Ángela` used to put a `Ã` in the circle.
    for (const name of ['José Solís', 'Andrés Ramírez', 'Muñoz', 'Peña', 'Ángela Núñez']) {
      const claims = decodeJwtPayload(makeUtf8Token({ role: 'employee', name }))
      expect(claims?.name).toBe(name)
      expect(String(claims?.name).charAt(0)).toBe(name.charAt(0))
    }
  })

  it('decodes multi-byte characters beyond Latin-1 (three-byte and astral)', () => {
    // Not decoration: it pins that the decoder handles the full UTF-8 range rather than
    // just the two-byte accents, which a byte-swapping half-fix would also pass.
    const name = '北京 – Ana 😀'
    expect(decodeJwtPayload(makeUtf8Token({ name }))?.name).toBe(name)
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
