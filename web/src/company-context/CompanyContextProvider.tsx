import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  readSelectedCompanyId,
  readSessionClaims,
  resolveCompanyScope,
  writeSelectedCompanyId,
} from './companyContext'
import { CompanyContext } from './context'

export interface CompanyContextProviderProps {
  children: ReactNode
}

/**
 * Holds the SuperAdmin's company selection for the lifetime of the shell.
 *
 * `localStorage` is the persistence; this is the *liveness*. Without a shared
 * in-memory copy, changing the selector would only take effect on the next full
 * page load, which is exactly the kind of half-applied global scope switch the
 * feature exists to avoid — a page still showing company A's action plans under a
 * header that now says company B.
 *
 * Mounted by `AdminLayout`, so every routed page is inside it. Pages read it via
 * `useCompanyScope()`.
 */
export default function CompanyContextProvider({ children }: CompanyContextProviderProps) {
  // Read once on mount rather than on every render: `localStorage` is the source
  // of truth, but reading it in a render body makes the component impure. Same
  // reasoning as `ShellControls`'s theme picker.
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(() =>
    readSelectedCompanyId(),
  )

  // Destructured rather than kept as an object so the memo below has stable
  // primitive dependencies -- `readSessionClaims()` returns a fresh object every
  // render, which would defeat the memo entirely.
  const { role, companyId } = readSessionClaims()

  const selectCompany = useCallback((next: string | null) => {
    writeSelectedCompanyId(next)
    setSelectedCompanyId(next)
  }, [])

  // How many mounted pages draw their own company strip, or are about no company at all,
  // and so asked the header switcher to stand down (`useHeaderSwitcherStandDown`). A count
  // rather than a flag: a page leaving must not re-open the switcher under a page that is
  // still asking. Each release runs once, whatever React does with the effect.
  const [standDowns, setStandDowns] = useState(0)
  const standDownHeaderSwitcher = useCallback(() => {
    setStandDowns((count) => count + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      setStandDowns((count) => Math.max(0, count - 1))
    }
  }, [])

  const value = useMemo(
    () => ({
      scope: resolveCompanyScope({ role, companyId }, selectedCompanyId),
      selectedCompanyId,
      selectCompany,
      headerSwitcherStandsDown: standDowns > 0,
      standDownHeaderSwitcher,
    }),
    [role, companyId, selectedCompanyId, selectCompany, standDowns, standDownHeaderSwitcher],
  )

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
}
