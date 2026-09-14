import { useContext, useEffect } from 'react'
import { CompanyContext } from './context'

/**
 * Asks the shell header's company switcher (`CompanyContextSwitcher`) to stand down while
 * the calling page is mounted.
 *
 * Two kinds of page call it, and the per-role canvas (10 Sep) draws both with no switcher
 * in the header strip:
 *
 * - a company-scoped page that draws the canvas's own "Contexto de empresa" strip at the
 *   top of its card (`components/layout/CompanyContextBar.tsx`) — the strip IS the switcher
 *   there, and a second one in the header would be two controls for one selection;
 * - a platform page that no company scopes (`/admin/system`, `/admin/system-settings`) —
 *   a tenant picker above a page no tenant changes would promise a scope that does not
 *   exist.
 *
 * It is a registration, not a route list: the header stands down exactly while such a
 * page is mounted, so a route added later cannot fall out of step with a table. Safe
 * outside a `CompanyContextProvider` (the hook reads the context directly and does
 * nothing without one), so a page rendered alone in a test needs no provider for it.
 *
 * @param active `false` registers nothing — the bar passes the viewer's role here, so a
 *   company administrator (who has no switcher) never registers one.
 */
export function useHeaderSwitcherStandDown(active = true): void {
  const context = useContext(CompanyContext)
  const standDown = context?.standDownHeaderSwitcher
  useEffect(() => {
    if (!active || !standDown) return
    return standDown()
  }, [active, standDown])
}
