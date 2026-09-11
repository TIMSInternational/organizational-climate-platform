import { useEffect, useId, useState } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { useCompanyContext } from '../../company-context'
import { useHeaderSwitcherStandDown } from '../../company-context/useHeaderSwitcherStandDown'
import { listCompanies, type Company } from '../../features/org-structure/api/companies'
import { useTranslation } from '../../i18n'
import { cn } from '../../lib/cn'
import { Chip } from '../ui'

/**
 * The per-role canvas's "Contexto de empresa" strip (10 Sep): the super administrator's
 * company switcher, drawn at the top of a company-scoped page's card instead of in the
 * header strip — label, a 250px select, a chip saying whether a company is chosen, and a
 * sentence on the right that says what the choice does on THIS page (`note`).
 *
 * It writes the one selection every page reads (`selectCompany`, #124) — the same one the
 * header's `CompanyContextSwitcher` writes — and asks that header switcher to stand down
 * while it is mounted (`useHeaderSwitcherStandDown`), so the screen never carries two
 * controls for one choice. Nothing is chosen by default: "Ninguna empresa seleccionada" is
 * a real, long-lived state, and the chip says so.
 *
 * Renders nothing for any other role: a company administrator's scope is their token's
 * tenant, and `GET /admin/companies` would answer them 403 (`CompanyEndpoints.cs:29`), so
 * the list is never requested for them either.
 */
export default function CompanyContextBar({ note }: { note: string }) {
  const { t } = useTranslation()
  const { scope, selectedCompanyId, selectCompany } = useCompanyContext()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const selectId = useId()
  const [companies, setCompanies] = useState<Company[]>([])
  const [failed, setFailed] = useState(false)
  const isSuperAdmin = scope.isSuperAdmin

  useHeaderSwitcherStandDown(isSuperAdmin)

  useEffect(() => {
    if (!isSuperAdmin) return
    let cancelled = false
    listCompanies(baseUrl)
      .then((result) => {
        if (!cancelled) setCompanies(result)
      })
      .catch(() => {
        // A chosen company stays chosen when the list fails; saying so keeps an empty
        // select from reading as "there are no companies".
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [baseUrl, isSuperAdmin])

  if (!isSuperAdmin) return null
  const chosen = selectedCompanyId !== null

  return (
    <div
      data-slot="company-context-bar"
      className="mb-4 flex flex-wrap items-center gap-3 border-b border-line-light pb-3"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-icon-box text-fg-secondary [&_svg]:size-4"
      >
        <Copy />
      </span>
      <label
        htmlFor={selectId}
        className="m-0 whitespace-nowrap text-2xs font-bold uppercase tracking-label text-fg-label"
      >
        {t('companyContext.label')}
      </label>
      {/* A native select, as the header's switcher and the list filters use (ui/select.tsx
          prefers one for a plain list), drawn as the canvas draws it: no platform arrow,
          the thin 14px chevron, 250px. `mt-0 block`: `index.css` gives a select in a label
          4px above it. */}
      <span className="relative w-62.5 max-w-full shrink-0">
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-fg-label"
        />
        <select
          id={selectId}
          data-slot="company-context-select"
          value={selectedCompanyId ?? ''}
          onChange={(event) => selectCompany(event.target.value === '' ? null : event.target.value)}
          className={cn('mt-0 block w-full appearance-none pr-8', !chosen && 'text-fg-light')}
        >
          <option value="">{t('companyContext.noneSelected')}</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </span>
      {chosen ? (
        <Chip tone="good" icon={<Check className="size-3" />} label={t('companyContext.next.active')} />
      ) : (
        <Chip tone="neutral" label={t('companyContext.next.unchosen')} />
      )}
      {failed && (
        <span role="alert" className="text-sm text-fg-secondary">
          {t('companyContext.loadFailed')}
        </span>
      )}
      <p className="m-0 max-w-prose text-sm leading-snug text-fg-tertiary sm:ml-auto sm:text-right">{note}</p>
    </div>
  )
}
