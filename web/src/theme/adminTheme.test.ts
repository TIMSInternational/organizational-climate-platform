import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ADMIN_THEME_ATTRIBUTE,
  ADMIN_THEME_STORAGE_KEY,
  applyAdminTheme,
  initAdminTheme,
  readAdminThemeMode,
  resolveAdminTheme,
  setAdminThemeMode,
} from './adminTheme'

type Listener = () => void

/** Stands in for matchMedia so the OS preference can be driven from a test. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<Listener>()
  const query = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  )
  return {
    query,
    listenerCount: () => listeners.size,
    emit: (nowDark: boolean) => {
      query.matches = nowDark
      for (const listener of listeners) listener()
    },
  }
}

describe('admin theme mode', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute(ADMIN_THEME_ATTRIBUTE)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to light when nothing is stored', () => {
    expect(readAdminThemeMode()).toBe('light')
  })

  it('defaults to light when the stored value is not a mode', () => {
    localStorage.setItem(ADMIN_THEME_STORAGE_KEY, 'sepia')
    expect(readAdminThemeMode()).toBe('light')
  })

  it('reads the legacy AdminThemeContext storage key', () => {
    localStorage.setItem(ADMIN_THEME_STORAGE_KEY, 'dark')
    expect(readAdminThemeMode()).toBe('dark')
  })

  it('resolves system against the OS preference', () => {
    stubMatchMedia(true)
    expect(resolveAdminTheme('system')).toBe('dark')
    stubMatchMedia(false)
    expect(resolveAdminTheme('system')).toBe('light')
  })

  it('resolves to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(resolveAdminTheme('system')).toBe('light')
  })

  it('writes the resolved theme onto the document element', () => {
    expect(applyAdminTheme('dark')).toBe('dark')
    expect(document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE)).toBe('dark')

    expect(applyAdminTheme('light')).toBe('light')
    expect(document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE)).toBe('light')
  })

  it('persists and applies a chosen mode', () => {
    setAdminThemeMode('dark')
    expect(localStorage.getItem(ADMIN_THEME_STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE)).toBe('dark')
  })

  it('persists system as system, not as its resolved value', () => {
    stubMatchMedia(true)
    setAdminThemeMode('system')
    expect(localStorage.getItem(ADMIN_THEME_STORAGE_KEY)).toBe('system')
    expect(document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE)).toBe('dark')
  })

  it('applies the stored mode on init', () => {
    localStorage.setItem(ADMIN_THEME_STORAGE_KEY, 'dark')
    initAdminTheme()
    expect(document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE)).toBe('dark')
  })

  it('follows OS changes while in system mode, and stops on unsubscribe', () => {
    const media = stubMatchMedia(false)
    localStorage.setItem(ADMIN_THEME_STORAGE_KEY, 'system')

    const unsubscribe = initAdminTheme()
    expect(document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE)).toBe('light')

    media.emit(true)
    expect(document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE)).toBe('dark')

    unsubscribe()
    expect(media.listenerCount()).toBe(0)
    media.emit(false)
    expect(document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE)).toBe('dark')
  })

  it('does not subscribe to the OS preference for an explicit mode', () => {
    const media = stubMatchMedia(true)
    localStorage.setItem(ADMIN_THEME_STORAGE_KEY, 'light')

    initAdminTheme()
    expect(media.listenerCount()).toBe(0)
    expect(document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE)).toBe('light')
  })
})
