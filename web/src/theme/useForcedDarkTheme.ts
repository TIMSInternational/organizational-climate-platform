import { useLayoutEffect } from 'react'
import { applyAdminTheme, readAdminThemeMode } from './adminTheme'

/**
 * Pins the palette to dark for as long as the calling component is mounted, WITHOUT
 * touching what the reader chose.
 *
 * `/login` is drawn dark for everyone (`LoginNextPage` records why), and the reader may
 * well have chosen light. Those two facts have to coexist: the screen is dark, and the app
 * they land in one submit later is still theirs.
 *
 * ## Applied, not stored — the distinction the whole hook turns on
 *
 * `adminTheme.ts` separates the two operations, and this uses the one that does not
 * persist. `applyAdminTheme` writes `data-admin-theme` on `<html>` and nothing else;
 * `setAdminThemeMode` is what writes `localStorage['admin-theme']`, and it is deliberately
 * NOT called here. Reaching for the setter is the obvious mistake, and its symptom is a
 * user who visits a login page once and finds their whole account dark afterwards.
 * `authNextPages.test.tsx` asserts all three halves of that: the attribute flips, the
 * stored value does not, and unmount puts the attribute back.
 *
 * ## Restoring through `readAdminThemeMode()` rather than a captured value
 *
 * Teardown re-reads the preference instead of restoring whatever was on `<html>` at mount.
 * The stored mode is the source of truth, and `system` has to be re-resolved on the way
 * out anyway — the OS may have flipped while the screen was up, and restoring a stale
 * concrete `light`/`dark` would leave a `system` reader pinned to the wrong one until
 * their next reload.
 *
 * ## The OS-change race, which is why there is a listener here at all
 *
 * When the stored mode is `system`, `adminTheme.ts` keeps a module-level
 * `prefers-color-scheme` listener that calls `applyAdminTheme('system')`. If the OS flips
 * to light while this screen is up, that listener fires and repaints the forced-dark login
 * page in the light palette — a dot field designed for a dark ground on a near-white one,
 * which is the grey noise `LoginNextPage` says it must never be.
 *
 * So this re-asserts dark on the same event. Ours is registered later than the module's,
 * and listeners run in registration order, so ours settles last. `matchMedia` is guarded
 * the same way `adminTheme.ts` guards it: it is absent in some test environments, and its
 * absence is not a reason to fail to set a theme.
 *
 * `useLayoutEffect`, not `useEffect`: the attribute has to be on `<html>` before the
 * browser paints, or the reader sees one light frame of a screen that is meant to be dark.
 */
export function useForcedDarkTheme(): void {
  useLayoutEffect(() => {
    // `applyAdminTheme('dark')` resolves to `dark` and writes only the attribute.
    applyAdminTheme('dark')

    const query =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null
    const reassert = () => {
      applyAdminTheme('dark')
    }
    query?.addEventListener?.('change', reassert)

    return () => {
      query?.removeEventListener?.('change', reassert)
      applyAdminTheme(readAdminThemeMode())
    }
  }, [])
}
