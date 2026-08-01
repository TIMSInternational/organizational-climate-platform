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
    const json = atob(padded)
    const parsed = JSON.parse(json) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
