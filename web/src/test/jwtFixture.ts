/**
 * The one place a test builds a JWT fixture.
 *
 * ## Why this exists (#384, following #375 and #382)
 *
 * Thirty-three test files each carried their own copy of this function, and every copy
 * used `btoa(JSON.stringify(claims))`. `btoa` encodes **Latin-1, not UTF-8**: above
 * U+00FF it throws outright, and below it — which is where every Spanish accent lives —
 * it silently writes one byte where the real API writes two. `í` is U+00ED, so `btoa`
 * emits `0xED` while the API emits `0xC3 0xAD`.
 *
 * Before #382 those fixtures round-tripped *correctly* through the then-broken decoder,
 * which is precisely why an accented-name regression could not be caught and the decoder
 * stayed broken. #382 fixed the decoder, which inverted the polarity of the trap: a
 * fixture built with `btoa` now makes **correct code fail**, and the obvious repair is to
 * weaken the assertion or the decoder — undoing #382.
 *
 * That matters here more than it would elsewhere. This product is delivered in Spanish to
 * a Costa Rican agency, so `María`, `Ángela` and `Hernández` are ordinary names, not
 * exotic edge cases.
 *
 * Encoding is the same operation the product performs: UTF-8 bytes, then base64url. It
 * matches `scripts/shot-harness.mjs`'s `Buffer.from(json, 'utf8').toString('base64url')`
 * on the Node side, so a fixture is the same token in a test, a screenshot and production.
 *
 * The header is the literal string `header`, matching what every migrated call site
 * already did: `decodeJwtPayload` reads only the middle segment, and a fixture that
 * pretended to carry a real signed header would be claiming something it cannot deliver.
 */
export function tokenFor(claims: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(claims))
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  const body = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `header.${body}.signature`
}
