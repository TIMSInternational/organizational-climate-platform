import { useEffect } from 'react'
import { useCompanyContext } from './useCompanyScope'

/**
 * Moves a super administrator's header to the company of the record they just opened.
 *
 * The header's selection is where NEW work goes — "Nueva encuesta", Departamentos, the
 * dashboard — and the Empresas list already moves it on "Abrir". Pages about one existing
 * survey did not, so the header could say one client while the page showed another's survey,
 * and the next "Nueva encuesta" landed in a client the operator was no longer looking at
 * (docs/audits/2026-11-08-operator-ui-walkthrough.md, A1 and C).
 *
 * Only for a super administrator: everyone else's company is their claim, and the selection is
 * never consulted for them (`resolveCompanyScope`). `undefined` — the record has not loaded —
 * does nothing, so a page cannot clear the header while it is still reading.
 */
export function useFollowCompany(companyId: string | undefined): void {
  const { scope, selectedCompanyId, selectCompany } = useCompanyContext()
  useEffect(() => {
    if (scope.isSuperAdmin && companyId && selectedCompanyId !== companyId) selectCompany(companyId)
  }, [scope.isSuperAdmin, companyId, selectedCompanyId, selectCompany])
}
