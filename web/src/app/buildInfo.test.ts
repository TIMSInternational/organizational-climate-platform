import { describe, expect, it } from 'vitest'
import { buildInfo } from './buildInfo'

/**
 * Vitest runs under the same `vite.config.ts`, so the `define` block that stamps a real
 * build also stamps this process: in a git checkout `commit` is HEAD, on Vercel it is
 * `VERCEL_GIT_COMMIT_SHA`, and anywhere neither exists it is the literal `unknown`.
 */
describe('buildInfo', () => {
  it('names a commit as a 40-hex SHA or the literal unknown, never anything else', () => {
    expect(buildInfo.commit).toMatch(/^(?:[0-9a-f]{40}|unknown)$/)
  })

  it('names a build time as ISO-8601 UTC or the literal unknown', () => {
    expect(buildInfo.builtAt).toMatch(/^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z|unknown)$/)
  })

  it('is frozen: a stamp is read, never rewritten at runtime', () => {
    expect(Object.isFrozen(buildInfo)).toBe(true)
  })
})
