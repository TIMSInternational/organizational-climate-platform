import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Info, Languages, Plus, Search } from 'lucide-react'
import { useTranslation } from '../../../../i18n'
import { PageTopBar } from '../../../../components/layout'
import { Button, Chip, EmptyState, Input, LoadingRegion, NetworkError, SkeletonText, Table } from '../../../../components/ui'
import { useViewerCapabilities } from '../../../../auth/viewerCapabilities'
import { useCompanyContext } from '../../../../company-context'
import { calendarDay } from '../../../../lib/calendarDay'
import { cn } from '../../../../lib/cn'
import { createCompany } from '../../api/companies'
import CompanyForm, { type CompanyFormValues } from '../../components/CompanyForm'
import { CompanyValidation } from '../../components/companyValidation'
import { NO_PLAN, filterCompanyRows, isUnconfigured, type CompanyListRow } from './companiesList'
import { dayWithYear, languageText, longDay, sizeText, tierText } from './labels'
import { Note, Panel } from './parts'
import { useCompaniesListModel } from './useCompaniesListModel'

const TH =
  'border-b border-line-default bg-transparent px-3 pb-2 pt-1 text-2xs font-bold uppercase tracking-label whitespace-nowrap text-fg-tertiary'

/**
 * `/admin/companies` — the canvas's *Empresas* (`CompaniesList` artboard), which replaced
 * `CompaniesListPage` on this route; the old page stays in the tree, unrouted, as the
 * wiring reference.
 *
 * Plain and honest, as the triage asks of an internal page: one table of tenants with
 * sector and size, country, the content language each new survey inherits, the plan, the
 * headcount, the open wave and the day it was added; "Abrir" makes the tenant the active
 * company of the header and opens its detail; one primary action, *Nueva empresa*, which
 * opens the same `CompanyForm` and the same `POST /admin/companies` the old page used.
 *
 * Every read here is super-only (`CompanyEndpoints.cs:29`), so a viewer without
 * `canManageCompanies` gets a sentence and no request — a list that loads and then 403s
 * is the failure `viewerCapabilities` exists to prevent.
 */
export default function CompaniesListNextPage() {
  const { t } = useTranslation()
  const capabilities = useViewerCapabilities()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(params.get('new') === '1')
  const [search, setSearch] = useState('')
  const [plan, setPlan] = useState('')
  const state = useCompaniesListModel(capabilities.canManageCompanies)
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string

  function closeCreate() {
    setCreating(false)
    if (params.has('new')) setParams({}, { replace: true })
  }

  async function handleCreate(values: CompanyFormValues) {
    await createCompany(baseUrl, {
      name: values.name,
      emailDomain: values.emailDomain,
      industry: values.industry,
      size: values.size,
      country: values.country,
      subscriptionTier: values.subscriptionTier || undefined,
    })
    closeCreate()
    state.reload()
  }

  const header = (
    <PageTopBar
      eyebrow={t('navigation.systemAdministration')}
      title={t('navigation.companies')}
      description={t('superadmin.next.companies.description')}
      actions={
        capabilities.canManageCompanies ? (
          <Button type="button" variant="primary" onClick={() => (creating ? closeCreate() : setCreating(true))}>
            <Plus aria-hidden="true" />
            {t('superadmin.next.companies.newCompany')}
          </Button>
        ) : undefined
      }
    />
  )

  if (!capabilities.canManageCompanies) {
    return (
      <div>
        {header}
        <EmptyState title={t('superadmin.next.companies.superOnly')} />
      </div>
    )
  }

  const visible = filterCompanyRows(state.rows, search, plan)
  const unconfigured = state.rows.find(isUnconfigured)

  return (
    <div className="flex flex-col gap-section">
      {/* `PageTopBar` keeps 16px under its rule; the canvas has 24 before the filters. */}
      <div className="-mb-2">
        {header}
        {creating && (
          <Panel
            accent
            labelledBy="companies-create"
            heading={
              <h2 id="companies-create" className="m-0 text-2xl">
                {t('superadmin.next.companies.createHeading')}
              </h2>
            }
          >
            <CompanyForm submitLabel={t('superadmin.next.companies.create')} onSubmit={handleCreate} />
            <div>
              <Button type="button" variant="ghost" onClick={closeCreate}>
                {t('common.cancel')}
              </Button>
            </div>
          </Panel>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative m-0 w-full sm:w-80">
          <span className="sr-only">{t('superadmin.next.companies.searchPlaceholder')}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-light" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('superadmin.next.companies.searchPlaceholder')}
            className="w-full pl-8"
          />
        </label>
        <label className="m-0">
          <span className="sr-only">{t('superadmin.next.companies.planFilterLabel')}</span>
          <select className="w-40" value={plan} onChange={(event) => setPlan(event.target.value)}>
            <option value="">{t('superadmin.next.companies.allPlans')}</option>
            {CompanyValidation.subscriptionTiers.map((tier) => (
              <option key={tier} value={tier}>
                {tierText(t, tier)}
              </option>
            ))}
            <option value={NO_PLAN}>{t('superadmin.next.companies.noPlan')}</option>
          </select>
        </label>
        {state.status === 'ready' && (
          <p className="m-0 text-xs text-fg-tertiary sm:ml-auto">
            {visible.length === 1
              ? t('superadmin.next.companies.countOne')
              : t('superadmin.next.companies.countMany', { count: visible.length })}
          </p>
        )}
      </div>

      {state.status === 'error' ? (
        <NetworkError
          title={t('superadmin.next.companies.loadFailed')}
          description={state.error ?? undefined}
          onRetry={state.reload}
          retryText={t('common.retry')}
        />
      ) : (
        <LoadingRegion loading={state.status === 'loading'} label={t('common.loading')}>
          {state.status === 'loading' ? (
            <SkeletonText lines={4} />
          ) : state.rows.length === 0 ? (
            <EmptyState title={t('superadmin.next.companies.empty')} />
          ) : visible.length === 0 ? (
            <EmptyState title={t('superadmin.next.companies.noMatch')} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-line-default bg-surface-card pt-2 shadow-sm">
              <Table aria-label={t('superadmin.next.companies.tableLabel')} className="min-w-240 table-fixed">
                <colgroup>
                  <col />
                  <col className="w-[17%]" />
                  <col className="w-28" />
                  <col className="w-24" />
                  <col className="w-28" />
                  <col className="w-22" />
                  <col className="w-36" />
                  <col className="w-28" />
                  <col className="w-22" />
                </colgroup>
                <thead>
                  <tr>
                    <th className={TH}>{t('superadmin.next.companies.colCompany')}</th>
                    <th className={TH}>{t('superadmin.next.companies.colSectorSize')}</th>
                    <th className={TH}>{t('superadmin.next.companies.colCountry')}</th>
                    <th className={TH}>{t('superadmin.next.companies.colLanguage')}</th>
                    <th className={TH}>{t('superadmin.next.companies.colPlan')}</th>
                    <th className={cn(TH, 'text-right')}>{t('superadmin.next.companies.colPeople')}</th>
                    <th className={TH}>{t('superadmin.next.companies.colActiveSurveys')}</th>
                    <th className={TH}>{t('superadmin.next.companies.colAdded')}</th>
                    <th className={TH}>
                      <span className="sr-only">{t('common.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <CompanyRow key={row.id} row={row} language={state.languages.get(row.id)} />
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </LoadingRegion>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Note icon={<Languages />} lead={t('superadmin.next.companies.languageLead')}>
          {t('superadmin.next.companies.languageNote')}
        </Note>
        <Note icon={<Info />} lead={t('superadmin.next.companies.unsetLead')}>
          {t('superadmin.next.companies.unsetNote')}
          {unconfigured && (
            <>
              {' '}
              <UnconfiguredExample row={unconfigured} />
            </>
          )}
        </Note>
        <Note icon={<Plus />} lead={t('superadmin.next.companies.newLead')}>
          {t('superadmin.next.companies.newNote')}
        </Note>
      </div>
    </div>
  )
}

function UnconfiguredExample({ row }: { row: CompanyListRow }) {
  const { t, locale } = useTranslation()
  return <>{t('superadmin.next.companies.unsetExample', { company: row.name, date: longDay(row.createdAt, locale) })}</>
}

function CompanyRow({ row, language }: { row: CompanyListRow; language: string | null | undefined }) {
  const { t, locale } = useTranslation()
  const { selectCompany } = useCompanyContext()
  const navigate = useNavigate()
  const size = sizeText(t, row.size)
  const tier = tierText(t, row.subscriptionTier)
  const languageName = language ? languageText(t, language) : null

  return (
    <tr data-company-id={row.id}>
      <td className="px-3 py-3">
        <Link
          to={`/admin/companies/${row.id}`}
          className="block truncate font-semibold text-fg-primary no-underline hover:underline"
        >
          {row.name}
        </Link>
        {row.emailDomain && <span className="block truncate text-2xs text-fg-light">{row.emailDomain}</span>}
      </td>
      <td className="px-3 py-3">
        <span className={cn('block truncate', row.industry ? 'text-fg-primary' : 'text-fg-light')}>
          {row.industry || t('superadmin.next.companies.noSector')}
        </span>
        <span className="block truncate text-2xs text-fg-light">{size ?? t('superadmin.next.companies.noSize')}</span>
      </td>
      <td className="px-3 py-3">
        {row.country ? (
          <span className="block truncate text-fg-primary">{row.country}</span>
        ) : (
          <span aria-hidden="true" className="text-fg-light">
            —
          </span>
        )}
      </td>
      <td className="px-3 py-3">
        {language === undefined ? (
          <span aria-hidden="true" className="text-fg-light">
            …
          </span>
        ) : language === null ? (
          <span className="text-xs text-fg-light">{t('superadmin.next.unavailable')}</span>
        ) : languageName ? (
          <span className="text-fg-primary">{languageName}</span>
        ) : (
          <span className="text-xs text-fg-light">{t('superadmin.next.companies.noLanguage')}</span>
        )}
      </td>
      <td className="px-3 py-3">
        {tier ? (
          <Chip tone="neutral" label={tier} />
        ) : (
          <span className="text-xs text-fg-light">{t('superadmin.next.companies.noPlan')}</span>
        )}
      </td>
      <td className="px-3 py-3 text-right font-mono text-sm tabular-nums text-fg-primary">
        {row.people === null ? <span aria-hidden="true">—</span> : row.people}
      </td>
      <td className="px-3 py-3">
        {row.activeSurveyCount === null ? (
          <span aria-hidden="true" className="text-fg-light">
            —
          </span>
        ) : (
          <>
            <span className="block font-mono tabular-nums text-fg-primary">{row.activeSurveyCount}</span>
            <span className="block truncate text-2xs text-fg-light">
              {row.openSurvey
                ? t('superadmin.next.companies.openLine', {
                    code: row.openSurvey.code,
                    date: calendarDay(Date.parse(row.openSurvey.endDate), locale),
                  })
                : row.surveyCount === 0
                  ? t('superadmin.next.companies.noSurveys')
                  : row.surveyCount === null
                    ? null
                    : t('superadmin.next.companies.noneOpen')}
            </span>
          </>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs tabular-nums text-fg-primary">
        {dayWithYear(row.createdAt, locale)}
      </td>
      <td className="px-3 py-3 text-right">
        <Button
          type="button"
          variant="outline"
          aria-label={t('superadmin.next.companies.openNamed', { name: row.name })}
          onClick={() => {
            selectCompany(row.id)
            navigate(`/admin/companies/${row.id}`)
          }}
        >
          {t('superadmin.next.companies.open')}
        </Button>
      </td>
    </tr>
  )
}
