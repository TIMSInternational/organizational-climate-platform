import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTrackingApiBaseUrl, isTrackingEnabled } from './config'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getTrackingApiBaseUrl', () => {
  it('reads VITE_TRACKING_API_BASE_URL', () => {
    vi.stubEnv('VITE_TRACKING_API_BASE_URL', 'http://tracking.test')
    expect(getTrackingApiBaseUrl()).toBe('http://tracking.test')
  })
})

describe('isTrackingEnabled', () => {
  it('is true when a tracking service is configured', () => {
    vi.stubEnv('VITE_TRACKING_API_BASE_URL', 'http://tracking.test')
    expect(isTrackingEnabled()).toBe(true)
  })

  /**
   * The three ways a deployment says "no tracking module here".
   *
   * The whitespace case is the one that matters in practice: a Vite `.env` line
   * written `VITE_TRACKING_API_BASE_URL= ` produces `" "`, which is truthy, and a
   * bare truthiness check would light up the whole module against an origin of
   * one space.
   */
  it('is false when the variable is unset, empty or blank', () => {
    vi.stubEnv('VITE_TRACKING_API_BASE_URL', '')
    expect(isTrackingEnabled()).toBe(false)

    vi.stubEnv('VITE_TRACKING_API_BASE_URL', '   ')
    expect(isTrackingEnabled()).toBe(false)

    vi.stubEnv('VITE_TRACKING_API_BASE_URL', undefined as unknown as string)
    expect(isTrackingEnabled()).toBe(false)
  })
})

/**
 * The example file is an INPUT to this flag, and that makes it part of the
 * module's behaviour rather than documentation about it.
 *
 * `isTrackingEnabled()` treats any non-blank value as "there is a tracking service
 * here", and `navSections.workspacePlanItems` responds by REPLACING the
 * `/action-plans` nav row with the tracking rows. So a `web/.env.example` that
 * ships `VITE_TRACKING_API_BASE_URL=http://localhost:5081` uncommented means the
 * ordinary `cp .env.example .env` silently removes a working page from the sidebar
 * and offers a module whose service is not running in its place — with no error
 * anywhere to explain where Action Plans went.
 *
 * Nothing else in the suite can see that: every other test here stubs the variable,
 * which is exactly what makes the file's default invisible. So this reads the file.
 */
describe('web/.env.example', () => {
  function exampleLines(): string[] {
    // `process.cwd()` is `web/` under vitest; the example sits at its root.
    return readFileSync(join(process.cwd(), '.env.example'), 'utf8').split('\n')
  }

  it('ships the tracking base URL COMMENTED OUT, so copying it changes no nav', () => {
    const assignments = exampleLines().filter((line) =>
      /^\s*VITE_TRACKING_API_BASE_URL\s*=/.test(line),
    )

    expect(
      assignments,
      'An uncommented VITE_TRACKING_API_BASE_URL in .env.example switches the ' +
        'tracking module on for anyone who copies the file, which REPLACES the ' +
        'Action Plans nav row. Comment the line out.',
    ).toEqual([])
  })

  it('still documents the variable, so it is discoverable when someone wants it', () => {
    const source = exampleLines().join('\n')
    expect(source).toContain('# VITE_TRACKING_API_BASE_URL=')
    expect(source).toContain('Action Plans')
  })

  it('leaves the other variables alone — only tracking is opt-in', () => {
    // Guard the guard: if the file moved or the glob broke, the assertion above
    // would pass against an empty list.
    const source = exampleLines().join('\n')
    expect(source).toMatch(/^VITE_API_BASE_URL=/m)
  })
})
