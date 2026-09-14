import { describe, it, expect } from 'vitest'
import { returnTo, safeReturnPath } from './returnPath'

/**
 * A destination handed to `navigate()` after a successful sign-in is an open-redirect
 * shape. The page that READS it has to be safe, whatever wrote it.
 */
describe('safeReturnPath', () => {
  it('accepts an in-app path, with its query', () => {
    expect(safeReturnPath({ from: '/microclimate-invitations/abc' })).toBe(
      '/microclimate-invitations/abc',
    )
    expect(safeReturnPath({ from: '/microclimate-invitations/abc?lang=es' })).toBe(
      '/microclimate-invitations/abc?lang=es',
    )
  })

  /**
   * `//evil.test/` is protocol-relative: the browser reads it as another ORIGIN, not as a
   * path, so a check that only looked for a leading slash would send a freshly
   * authenticated user off-site.
   */
  it('refuses another origin however it is spelled', () => {
    expect(safeReturnPath({ from: '//evil.test/steal' })).toBeNull()
    expect(safeReturnPath({ from: 'https://evil.test/steal' })).toBeNull()
    expect(safeReturnPath({ from: 'javascript:alert(1)' })).toBeNull()
    // Some browsers normalise a backslash to a slash, which would make this
    // protocol-relative after the check rather than before it.
    expect(safeReturnPath({ from: '/\\evil.test' })).toBeNull()
    expect(safeReturnPath({ from: '\\\\evil.test' })).toBeNull()
  })

  it('refuses anything that is not a string path on an object', () => {
    expect(safeReturnPath(null)).toBeNull()
    expect(safeReturnPath(undefined)).toBeNull()
    expect(safeReturnPath('/dashboard')).toBeNull()
    expect(safeReturnPath({})).toBeNull()
    expect(safeReturnPath({ from: 42 })).toBeNull()
    expect(safeReturnPath({ from: '' })).toBeNull()
    expect(safeReturnPath({ from: 'dashboard' })).toBeNull()
  })

  it('round-trips what `returnTo` writes', () => {
    expect(safeReturnPath(returnTo('/microclimate-invitations/tok'))).toBe(
      '/microclimate-invitations/tok',
    )
  })
})
