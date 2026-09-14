import { createContext } from 'react'
import type { CompanyScope } from './companyContext'

export interface CompanyContextValue {
  /** What the current session is scoped to right now. */
  scope: CompanyScope
  /**
   * The raw stored selection, whatever the role.
   *
   * Only the switcher needs this — it has to show a SuperAdmin what is selected.
   * Pages read {@link CompanyContextValue.scope} instead, which is the value that
   * has had the role rules applied to it.
   */
  selectedCompanyId: string | null
  /** Sets (or, with `null`, clears) the SuperAdmin's company context. */
  selectCompany: (companyId: string | null) => void
  /**
   * True while at least one mounted page has asked the header's switcher to stand down
   * (`useHeaderSwitcherStandDown`). Optional, with the registration below, so a value
   * built by hand — a test's provider — need not know about it.
   */
  headerSwitcherStandsDown?: boolean
  /** Registers one stand-down and returns its release. */
  standDownHeaderSwitcher?: () => () => void
}

/**
 * Split out of the provider file for the same reason `i18n/context.ts` is: a
 * `.tsx` module that exports both a component and a non-component trips
 * `react(only-export-components)`, and the ten-warning lint budget has no room.
 */
export const CompanyContext = createContext<CompanyContextValue | null>(null)
