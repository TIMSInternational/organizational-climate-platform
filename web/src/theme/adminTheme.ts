/**
 * Admin theme mode.
 *
 * The token layer ships a light and a dark palette (`src/styles/tokens.css`),
 * selected by `data-admin-theme` on `<html>`. This module is what sets that
 * attribute — without it the dark palette is unreachable code.
 *
 * The contract is the legacy `AdminThemeContext`'s, unchanged, so a user's
 * stored preference carries over from the Next.js app:
 *   - localStorage key `admin-theme`
 *   - values `light` | `dark` | `system`
 *   - default `light`
 *
 * `system` is resolved *here*, to a concrete `light`/`dark`, rather than in CSS:
 * a `prefers-color-scheme` block would need its own copy of the palette, and a
 * duplicated palette is the token drift (#169) the layer exists to prevent.
 */

export type AdminThemeMode = 'light' | 'dark' | 'system'
export type AdminTheme = 'light' | 'dark'

export const ADMIN_THEME_STORAGE_KEY = 'admin-theme'
export const ADMIN_THEME_ATTRIBUTE = 'data-admin-theme'

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'
const MODES: readonly AdminThemeMode[] = ['light', 'dark', 'system']

function isMode(value: unknown): value is AdminThemeMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}

function darkMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(DARK_MEDIA_QUERY)
}

/** The stored preference, or `light` when nothing is stored or storage is unavailable. */
export function readAdminThemeMode(): AdminThemeMode {
  try {
    const stored = window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY)
    return isMode(stored) ? stored : 'light'
  } catch {
    // Storage can throw outright in private-browsing / blocked-cookie modes.
    return 'light'
  }
}

/** Collapses `system` onto the OS preference. Anything unresolvable is light. */
export function resolveAdminTheme(mode: AdminThemeMode): AdminTheme {
  if (mode === 'dark') return 'dark'
  if (mode === 'light') return 'light'
  return darkMediaQuery()?.matches ? 'dark' : 'light'
}

/** Writes the resolved theme onto `<html>`. Returns what it resolved to. */
export function applyAdminTheme(mode: AdminThemeMode): AdminTheme {
  const theme = resolveAdminTheme(mode)
  document.documentElement.setAttribute(ADMIN_THEME_ATTRIBUTE, theme)
  return theme
}

/**
 * Teardown for the live `prefers-color-scheme` listener, or null when not in
 * `system` mode.
 *
 * This is module state on purpose. The listener has to outlive whichever call
 * created it — `initAdminTheme` at startup, or a later `setAdminThemeMode` — and
 * exactly one may exist at a time. Tracking it per-caller is what let the
 * previous version strand a listener: switching from `system` to an explicit
 * mode left the old subscription attached, so the next OS change overwrote the
 * user's explicit choice.
 */
let unsubscribeFromSystem: (() => void) | null = null

/**
 * Points the OS-preference subscription at `mode`: attached for `system`,
 * detached for anything explicit. Safe to call repeatedly.
 */
function syncSystemSubscription(mode: AdminThemeMode): void {
  unsubscribeFromSystem?.()
  unsubscribeFromSystem = null

  if (mode !== 'system') return

  const query = darkMediaQuery()
  if (!query || typeof query.addEventListener !== 'function') return

  const onChange = () => applyAdminTheme('system')
  query.addEventListener('change', onChange)
  unsubscribeFromSystem = () => query.removeEventListener('change', onChange)
}

/** Persists the preference and applies it. Returns the resolved theme. */
export function setAdminThemeMode(mode: AdminThemeMode): AdminTheme {
  try {
    window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, mode)
  } catch {
    // Not being able to remember the choice is not a reason to not apply it.
  }
  syncSystemSubscription(mode)
  return applyAdminTheme(mode)
}

/**
 * Applies the stored preference and keeps `system` following the OS.
 *
 * Called from `src/main.tsx` before the first render, so the attribute is on
 * `<html>` before anything paints. Returns a teardown function; calling it also
 * clears any subscription a later `setAdminThemeMode` installed.
 */
export function initAdminTheme(): () => void {
  const mode = readAdminThemeMode()
  applyAdminTheme(mode)
  syncSystemSubscription(mode)

  return () => {
    unsubscribeFromSystem?.()
    unsubscribeFromSystem = null
  }
}
