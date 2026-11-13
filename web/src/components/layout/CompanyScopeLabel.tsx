import { useOwnCompanyBrand, useOwnDepartmentName } from '../../company-context/useCompanyName'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import { RailCompaniesIcon } from '../../navigation/railIcons'

export interface CompanyScopeLabelProps {
  /** The caller's role claim. The label is for the roles whose scope is their own claim. */
  role: string | undefined
}

/**
 * The company a company administrator works in — and, for a leader, their department — in
 * the top bar, where the super administrator's company selector sits (CompanyHome.dc.html:
 * "Meridiano"; TeamHome.dc.html: "Meridiano · Operaciones").
 *
 * It is a label, not a control: these roles are scoped by their own token, so there is no
 * other company to choose. It wears the selector's well (the sunken navy, the chrome's
 * hairline) so the bar reads the same for every role, but no chevron and no focus stop —
 * a well with a chevron would promise a menu that is not there.
 *
 * The names come from `GET /profile`, through the same per-token promise the shell already
 * awaits for the tenant mark (`useOwnCompanyBrand`), so this adds no request. Renders nothing
 * for a super administrator (their selector says it), for any other role, and until the
 * profile has answered — an empty well would read as a company with no name.
 */
export function CompanyScopeLabel({ role }: CompanyScopeLabelProps) {
  const { t } = useTranslation()
  const scoped = role === 'company_admin' || role === 'leader'
  const { companyName, logoUrl } = useOwnCompanyBrand(scoped)
  const departmentName = useOwnDepartmentName(role === 'leader')

  if (!scoped || !companyName) return null
  const text = departmentName ? t('shell.companyAndDepartment', { company: companyName, department: departmentName }) : companyName

  return (
    // Below `md` a company with a logo is already named in this bar — `AdminLayout`'s
    // `MobileTenantLogo` draws it at the bar's leading edge there — so the label steps aside
    // and a 390px bar keeps room for search and the bell. From `md` the rail opens on the OCC
    // mark instead, and the label is the bar's only word on whose data this is.
    <span data-slot="company-scope" className={cn('min-w-0 items-center gap-inline', logoUrl ? 'hidden md:flex' : 'flex')}>
      <RailCompaniesIcon aria-hidden="true" className="size-icon shrink-0 text-fg-tertiary" />
      <span className="inline-flex h-control-lg min-w-0 max-w-80 items-center rounded-md border border-line-default bg-surface-shell-sunken px-3">
        <span className="truncate text-ui font-medium text-fg-primary">
          <span className="sr-only">{t('shell.companyScope')} </span>
          {text}
        </span>
      </span>
    </span>
  )
}
