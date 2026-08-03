import { ADMIN_THEME_ATTRIBUTE } from '../../theme/adminTheme'

/**
 * The theme to hand sonner.
 *
 * The legacy `sonner.tsx` read this from `next-themes`, which does not exist
 * here. This app owns its theme in `src/theme/adminTheme.ts`, written to
 * `data-admin-theme` on `<html>`, so the value is read from there.
 *
 * Extracted rather than inlined because sonner renders a bare `<section>` that
 * forwards neither a `data-slot` nor a `data-theme`, so the wiring cannot be
 * asserted from the DOM — but it can be asserted here.
 */
export function resolveToasterTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute(ADMIN_THEME_ATTRIBUTE) === 'dark'
    ? 'dark'
    : 'light'
}
