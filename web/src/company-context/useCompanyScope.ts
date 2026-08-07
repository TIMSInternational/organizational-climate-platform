import { useContext } from 'react'
import { CompanyContext, type CompanyContextValue } from './context'
import type { CompanyScope } from './companyContext'

/**
 * The switcher's hook: the selection plus the setter.
 *
 * Throws outside a provider rather than returning a default. A silent default
 * here would be a company-scoped page reading `undefined` and deciding for itself
 * what to do about it, which is the per-page invention this module replaces.
 */
export function useCompanyContext(): CompanyContextValue {
  const value = useContext(CompanyContext)
  if (!value) {
    throw new Error('useCompanyContext must be used inside a CompanyContextProvider')
  }
  return value
}

/**
 * **The hook every company-scoped page uses.**
 *
 * Replaces the `decodeJwtPayload(getToken())` + normalise-`''` + special-case
 * SuperAdmin block that each of them had copied. Branch on `scope.status`:
 *
 * ```tsx
 * const scope = useCompanyScope()
 * if (scope.status === 'needs-selection') return <ChooseACompany />
 * if (scope.status === 'no-company') return <NoCompanyAssociated />
 * // scope.companyId is a string here
 * ```
 *
 * `companyId` is typed `string | undefined` rather than narrowed by the status,
 * because a discriminated union keyed on `status` would make every call site
 * handle three cases even where two of them are the same. The three-branch shape
 * above is the intended one and is what the page tests pin.
 */
export function useCompanyScope(): CompanyScope {
  return useCompanyContext().scope
}
