// Minimal, dependency-free JWT payload decode. This deliberately does not verify the
// signature -- the token was just issued by our own API over HTTPS, this is purely for
// reading claims client-side (role/companyId) to decide where to route the user next.
// Any malformed input returns null rather than throwing.
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) {
    return null
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    // #375. `atob` returns a *binary* string -- one JavaScript character per byte -- and a
    // JWT payload is UTF-8. Parsing that string directly reads every multi-byte character
    // as its individual bytes reinterpreted as Latin-1, so the `name` claim the API issues
    // (`JwtTokenService.cs`, verified to write raw UTF-8 rather than \u escapes) turned
    // `María Herrera` into `MarÃ­a Herrera` in the rail, the account menu and the avatar
    // initial. Widening the bytes back out and decoding them as UTF-8 is the whole fix; it
    // is one pass over a payload of a few hundred bytes, done once per render.
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
