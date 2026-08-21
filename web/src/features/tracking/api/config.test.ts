import { describe, it, expect, afterEach, vi } from 'vitest'
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
