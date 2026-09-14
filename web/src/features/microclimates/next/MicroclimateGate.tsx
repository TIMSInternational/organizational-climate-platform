import type { ReactNode } from 'react'
import { useTranslation } from '../../../i18n'
import { useCompanyScope } from '../../../company-context'
import { EmptyState } from '../../../components/ui'

/**
 * Who may open a microclimate screen, decided before a single request is sent.
 *
 * Every microclimate read is an administrator's: `ListAsync`, `GetLiveResultsAsync`, the
 * export and the invitations list all open with `CanAccessCompany` (`MicroclimateEndpoints.cs`,
 * a `super_admin`, or the `company_admin` of the session's company), and an authenticated
 * `GET /microclimates/{id}` from anyone else is a 403 (`:679-686`). So a leader, supervisor or
 * employee who typed the URL meets the page's own sentence, never a spinner followed by a
 * refusal.
 *
 * `needsCompany`: the list and the create form name a company in the request, so a
 * `super_admin` with none chosen is asked to choose one. A single session names its own
 * company, so its detail and results do not need the selection.
 */
export function MicroclimateGate({ needsCompany, children }: { needsCompany: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  const scope = useCompanyScope()
  const admin = scope.isSuperAdmin || scope.role === 'company_admin'
  if (!admin) {
    return (
      <EmptyState
        title={t('microclimates.next.noAccessTitle')}
        description={t('microclimates.next.noAccessDescription')}
      />
    )
  }
  if (needsCompany && scope.status === 'needs-selection') {
    return (
      <EmptyState title={t('companyContext.chooseACompany')} description={t('companyContext.chooseACompanyDescription')} />
    )
  }
  if (needsCompany && scope.status === 'no-company') {
    return <p role="alert">{t('common.noCompanyAssociated')}</p>
  }
  return <>{children}</>
}
