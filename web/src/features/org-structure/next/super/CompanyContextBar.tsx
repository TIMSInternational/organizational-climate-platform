import { useId } from 'react'
import { Check, Copy } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { CanvasChip, CanvasSelect, IconBox } from './parts'

/**
 * The canvas's "Contexto de empresa" strip — the tenant switcher where it matters, at
 * the top of the two super-administrator pages whose subject changes with it: the
 * platform overview (nothing chosen: every tenant) and a tenant's Analítica (one
 * tenant, named).
 *
 * It writes the same selection the header's `CompanyContextSwitcher` writes, through
 * the caller's `onChange` — `selectCompany` on the overview, which `DashboardPage` turns
 * into that company's Panel de Control, or a navigation to the chosen tenant's page. It
 * never guesses a tenant: on the overview the empty option is a real, long-lived state
 * (#124), and the chip says so.
 */
export default function CompanyContextBar({
  companies,
  value,
  mode,
  onChange,
  isActive = false,
}: {
  companies: readonly { id: string; name: string }[]
  /** The company the page reads, or `null` on the platform overview. */
  value: string | null
  mode: 'platform' | 'tenant'
  onChange: (companyId: string | null) => void
  /** Tenant mode: whether `value` is also the header's active company. */
  isActive?: boolean
}) {
  const { t } = useTranslation()
  const selectId = useId()

  return (
    <div
      data-slot="company-context-bar"
      className="mb-panel flex flex-wrap items-center gap-3 border-b border-line-light pb-3"
    >
      <IconBox size="sm">
        <Copy />
      </IconBox>
      <label
        htmlFor={selectId}
        className="m-0 whitespace-nowrap text-2xs font-bold uppercase tracking-label text-fg-tertiary"
      >
        {t('companyContext.label')}
      </label>
      <CanvasSelect
        id={selectId}
        className="w-64 max-w-full"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      >
        {(mode === 'platform' || value === null) && <option value="">{t('companyContext.noneSelected')}</option>}
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </CanvasSelect>
      {mode === 'platform' ? (
        <CanvasChip tone="neutral" label={t('superadmin.next.context.unchosen')} />
      ) : isActive ? (
        <CanvasChip tone="good" icon={<Check className="size-3" />} label={t('superadmin.next.context.active')} />
      ) : (
        <CanvasChip tone="neutral" label={t('superadmin.next.context.notActive')} />
      )}
      <p className="m-0 max-w-measure text-xs leading-snug text-fg-tertiary sm:ml-auto sm:text-right">
        {mode === 'platform' ? t('superadmin.next.context.platformNote') : t('superadmin.next.context.tenantNote')}
      </p>
    </div>
  )
}
