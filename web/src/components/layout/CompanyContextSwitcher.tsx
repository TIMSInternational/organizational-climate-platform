import { useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import { useCompanyContext } from '../../company-context'
import { listCompanies, type Company } from '../../features/org-structure/api/companies'
import { useTranslation } from '../../i18n'

/**
 * The SuperAdmin's company-context selector (#124).
 *
 * ## Why it lives in the shell header
 *
 * Same argument `AdminLayout` makes for the notification bell, for a stronger
 * reason. The scope this control sets applies to every company-scoped page, so it
 * has to be legible *from* every one of them — a picker rendered per page would
 * appear on the pages that remembered to render it and silently leave the scope
 * unexplained everywhere else, which is the class of defect the whole issue is
 * about.
 *
 * It is deliberately **not** in `ShellControls`: that block is the sidebar footer,
 * which is hidden on a collapsed rail and absent entirely below `md`. A global
 * scope switch that vanishes on a phone, while the pages it scopes stay visible,
 * is worse than no switch.
 *
 * ## Why nothing is selected by default
 *
 * The empty option is not a placeholder for a value that will be filled in — it is
 * a real, expected, long-lived state. Defaulting to the first company, or to the
 * SuperAdmin's own `companyId` claim, is precisely the silent mis-scoping
 * `navSections.ts` and `ActionPlansListPage` were written around. So the select's
 * own value is the visible answer to "what am I looking at": it reads
 * "No company selected" until a human picks one.
 *
 * ## Why a native `<select>`
 *
 * `ui/select.tsx`'s own header says to prefer one for a plain list of options —
 * it is smaller, needs no portal, is already styled by the element layer in
 * `index.css` (so it is correct in both themes without this file naming a single
 * colour), and gets keyboard and screen-reader behaviour for free.
 * `LanguageSwitcher` and `ThemeSwitcher` are the same shape.
 */
export function CompanyContextSwitcher() {
  const { t } = useTranslation()
  const { scope, selectedCompanyId, selectCompany } = useCompanyContext()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [companies, setCompanies] = useState<Company[]>([])
  const [failed, setFailed] = useState(false)

  const isSuperAdmin = scope.isSuperAdmin

  useEffect(() => {
    // `GET /admin/companies` is SuperAdmin-only, so this must not fire for any
    // other role -- a 403 on every page load for every CompanyAdmin would be the
    // cost of a control they never see.
    if (!isSuperAdmin) return

    let cancelled = false
    listCompanies(baseUrl)
      .then((result) => {
        if (!cancelled) setCompanies(result)
      })
      .catch(() => {
        // The list failing does not invalidate an already-chosen context: the
        // stored id is still what pages scope by. Surfacing the failure keeps a
        // SuperAdmin from reading an empty dropdown as "there are no companies".
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, isSuperAdmin])

  // Below every hook, so the hook order is identical for every role.
  if (!isSuperAdmin) return null

  return (
    <div className="flex items-center gap-inline">
      <Building2 aria-hidden="true" className="size-icon shrink-0 text-fg-tertiary" />
      <select
        aria-label={t('companyContext.label')}
        value={selectedCompanyId ?? ''}
        onChange={(event) => selectCompany(event.target.value || null)}
        className="max-w-56"
      >
        <option value="">{t('companyContext.noneSelected')}</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
      {failed && (
        <span role="alert" className="text-sm text-fg-secondary">
          {t('companyContext.loadFailed')}
        </span>
      )}
    </div>
  )
}
