import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { getCompany, updateCompany, type CompanyDetail } from '../api/companies'
import { listDepartments, createDepartment, updateDepartment, type Department } from '../api/departments'
import { updateCompanySettings, type CompanySettingsResponse } from '../api/companySettings'
import CompanyForm, { type CompanyFormValues } from '../components/CompanyForm'
import CompanySettingsForm, { type CompanySettingsFormValues } from '../components/CompanySettingsForm'
import { AnonymityFloorNotice, AnonymityFloorReading } from '../components/AnonymityFloor'
import DepartmentList from '../components/DepartmentList'
import DepartmentForm, { type DepartmentFormValues } from '../components/DepartmentForm'
import { surveyFrequencyLabelKey } from '../labels'
import { useTranslation } from '../../../i18n'
import { ChartColumn, FileText, Tags, Users } from 'lucide-react'
import { ANONYMITY_FLOOR } from '../../../components/charts'
import { PageTopBar, QuickActions } from '../../../components/layout'
import { Button, Card, CardContent, CardHeader, CardTitle } from '../../../components/ui'

/**
 * Company Settings (UI redesign).
 *
 * ## What the page is now
 *
 * Identity, reporting rules and the anonymity floor, read as two tiles of
 * readings with the floor stated underneath — rather than the previous stack of
 * an unlabelled edit button, a "Load settings" button and two bare forms. The
 * settings themselves are *shown* before they are editable, because the common
 * act on this screen is checking what a company is configured for, not changing
 * it.
 *
 * ## The settings request is no longer behind a button
 *
 * `GET` for company settings does not exist on the API: `updateCompanySettings`
 * with an empty body is how you read them (every member of
 * `UpdateCompanySettingsRequest` is nullable, and `CompanyEndpoints` only assigns
 * the ones present, so `{}` writes nothing and returns the current record). That
 * quirk is why the page used to make you press "Load settings" first. A screen
 * whose whole subject is the settings cannot open with the settings missing, so
 * the same call now runs with the rest of the page load — the request is
 * unchanged, only its trigger.
 *
 * ## Three independent requests, three independent failures
 *
 * `GET /admin/companies/{id}` is **SuperAdmin-only** — stricter than settings,
 * departments and demographic fields, which all admit a CompanyAdmin on their own
 * company. A CompanyAdmin therefore always 403s on the profile, and that must not
 * take the rest of the page with it. Each of the three loads keeps its own error
 * state for that reason, and the identity tile degrades to a note rather than the
 * page degrading to an error.
 */
export default function CompanyDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const baseUrl = import.meta.env.VITE_API_BASE_URL as string
  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [companyProfileError, setCompanyProfileError] = useState<string | null>(null)
  const [companyProfileLoaded, setCompanyProfileLoaded] = useState(false)
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentsError, setDepartmentsError] = useState<string | null>(null)
  const [editingCompany, setEditingCompany] = useState(false)
  const [editingSettings, setEditingSettings] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null)
  const [creatingDepartment, setCreatingDepartment] = useState(false)
  const [companySettings, setCompanySettings] = useState<CompanySettingsResponse | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  async function reload() {
    if (!id) return

    try {
      const companyResult = await getCompany(baseUrl, id)
      setCompany(companyResult)
      setCompanyProfileError(null)
    } catch (err) {
      setCompany(null)
      setCompanyProfileError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setCompanyProfileLoaded(true)
    }

    try {
      const departmentsResult = await listDepartments(baseUrl, id)
      setDepartments(departmentsResult)
      setDepartmentsError(null)
    } catch (err) {
      setDepartmentsError(err instanceof Error ? err.message : t('errors.generic'))
    }

    try {
      // An empty body: a read dressed as a write, for the reason in the header.
      setCompanySettings(await updateCompanySettings(baseUrl, id, {}))
      setSettingsError(null)
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : t('errors.generic'))
    }
  }

  useEffect(() => {
    reload()
  }, [id])

  async function handleUpdateCompany(values: CompanyFormValues) {
    await updateCompany(baseUrl, id!, values)
    setEditingCompany(false)
    await reload()
  }

  async function handleCreateDepartment(values: DepartmentFormValues) {
    await createDepartment(baseUrl, {
      companyId: id!,
      name: values.name,
      description: values.description || undefined,
      parentDepartmentId: values.parentDepartmentId || undefined,
      isActive: values.isActive,
    })
    setCreatingDepartment(false)
    await reload()
  }

  async function handleUpdateDepartment(values: DepartmentFormValues) {
    await updateDepartment(baseUrl, editingDepartment!.id, {
      name: values.name,
      description: values.description,
      isActive: values.isActive,
    })
    setEditingDepartment(null)
    await reload()
  }

  async function handleUpdateSettings(values: CompanySettingsFormValues) {
    if (!id) return
    const result = await updateCompanySettings(baseUrl, id, values)
    setCompanySettings(result)
    setEditingSettings(false)
  }

  if (!companyProfileLoaded) {
    return <p>{t('common.loading')}</p>
  }

  const settings = companySettings?.settings

  return (
    <div>
      {/* No breadcrumb: the only crumb above this page is /admin/companies, which
          is SuperAdmin-only, and a company_admin reaches this page as their own
          company's home. A crumb they would be 403'd on is worse than none. */}
      <PageTopBar
        title={t('navigation.companySettings')}
        description={t('companySettings.description', { threshold: ANONYMITY_FLOOR })}
        // The company's own name belongs in the Identity tile, where it is the
        // first reading — not in the page title, which names the screen.
        badge={company ? { text: company.name, variant: 'secondary' } : undefined}
        actions={
          company && (
            <Button
              variant={editingCompany ? 'ghost' : 'default'}
              onClick={() => setEditingCompany((open) => !open)}
            >
              {editingCompany ? t('common.cancel') : t('dashboard.editCompany')}
            </Button>
          )
        }
      />

      {editingCompany && company && (
        <Card className="mb-panel-gap">
          <CardHeader>
            <CardTitle>{t('dashboard.editCompany')}</CardTitle>
          </CardHeader>
          <CardContent>
            <CompanyForm
              submitLabel={t('common.save')}
              initialValues={{
                name: company.name,
                emailDomain: company.emailDomain ?? '',
                industry: company.industry ?? '',
                size: company.size ?? '',
                country: company.country ?? '',
                subscriptionTier: company.subscriptionTier ?? '',
              }}
              onSubmit={handleUpdateCompany}
            />
          </CardContent>
        </Card>
      )}

      <div className="mb-panel-gap grid gap-panel-gap md:grid-cols-2">
        <section className="rounded-lg border border-line-light bg-surface-icon-box p-card">
          <div className="mb-panel-gap flex min-h-control-md flex-wrap items-center gap-inline">
            <h3 className="mb-0 text-lg">{t('companySettings.identity')}</h3>
          </div>
          {company ? (
            <div className="grid gap-panel-gap">
              <SettingReadout label={t('companySettings.companyName')} value={company.name} />
              <SettingReadout
                label={t('companySettings.emailDomain')}
                value={company.emailDomain}
                mono
              />
              <SettingReadout label={t('companySettings.industry')} value={company.industry} />
              <SettingReadout
                label={t('companySettings.people')}
                value={String(company.userCount)}
                mono
              />
            </div>
          ) : (
            // Not an error state for a CompanyAdmin viewing their own company —
            // just a section they are not entitled to. Reporting, the floor and
            // departments below are unaffected: they use a broader check.
            companyProfileError && <p className="mb-0">{t('dashboard.companyProfileAdminOnly')}</p>
          )}
        </section>

        <section className="rounded-lg border border-line-light bg-surface-icon-box p-card">
          <div className="mb-panel-gap flex min-h-control-md flex-wrap items-center justify-between gap-inline">
            <h3 className="mb-0 text-lg">{t('companySettings.reporting')}</h3>
            {settings && !editingSettings && (
              <Button size="sm" onClick={() => setEditingSettings(true)}>
                {t('companySettings.editReporting')}
              </Button>
            )}
          </div>
          <div className="grid gap-panel-gap">
            {settings ? (
              <>
                <SettingReadout
                  label={t('dashboard.surveyFrequency')}
                  // Translated where the cadence is one of the conventional four,
                  // and echoed verbatim otherwise — the field is free text on the
                  // wire (`CompanyEndpoints.cs` validates only non-emptiness), so
                  // the raw fallback is the ordinary path here, not a safety net.
                  // Printing it raw for every value meant a Spanish administrator
                  // read `quarterly` under *Frecuencia de encuestas*.
                  value={(() => {
                    const key = surveyFrequencyLabelKey(settings.surveyFrequency)
                    return key ? t(key) : settings.surveyFrequency
                  })()}
                />
                <AnonymityFloorReading />
                <SettingReadout
                  label={t('companySettings.dataRetention')}
                  value={`${settings.dataRetentionDays} ${t('companySettings.daysUnit')}`}
                  mono
                />
                <SettingReadout
                  label={t('companySettings.microclimates')}
                  value={
                    settings.microclimateEnabled
                      ? t('companySettings.enabled')
                      : t('companySettings.disabled')
                  }
                />
              </>
            ) : (
              <>
                {/* The floor is not read from the API and so is stated even when
                    the settings request failed — it is a platform guarantee, not
                    a per-company value this screen looked up. */}
                <AnonymityFloorReading />
                <p className="mb-0">{t('companySettings.settingsUnavailable')}</p>
              </>
            )}
          </div>
        </section>
      </div>

      <AnonymityFloorNotice />

      {settingsError && <p role="alert">{settingsError}</p>}

      {editingSettings && companySettings && (
        <Card className="mt-panel-gap">
          <CardHeader>
            <CardTitle>{t('companySettings.editReporting')}</CardTitle>
          </CardHeader>
          <CardContent>
            <CompanySettingsForm
              settings={companySettings.settings}
              branding={companySettings.branding}
              onSubmit={handleUpdateSettings}
            />
            <div className="mt-panel-gap">
              <Button variant="ghost" onClick={() => setEditingSettings(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ForMaps' quick-action tiles, and the reason this page has them: these four
          destinations used to be four bare `<Link>`s crammed into the header's
          `actions` slot, where they wrapped onto a second line and read as a row of
          undifferentiated blue text beside the company name. They are the four
          places you go *from* this page — and for a super_admin they are the only
          path to any of them, since their nav sections carry no company id by
          design (navSections.ts). */}
      <div className="mt-section">
        <QuickActions
          columns={4}
          title={t('dashboard.quickActions')}
          actions={[
            {
              id: 'users',
              label: t('dashboard.manageUsers'),
              href: `/admin/companies/${id}/users`,
              icon: Users,
            },
            {
              id: 'demographic-fields',
              label: t('dashboard.manageDemographicFields'),
              href: `/admin/companies/${id}/demographic-fields`,
              icon: Tags,
            },
            {
              id: 'reports',
              label: t('dashboard.viewReports'),
              href: `/admin/companies/${id}/reports`,
              icon: FileText,
            },
            {
              id: 'analytics',
              label: t('dashboard.viewAnalytics'),
              href: `/admin/companies/${id}/analytics`,
              icon: ChartColumn,
            },
          ]}
        />
      </div>

      <section className="mt-section">
        <div className="mb-panel-gap flex flex-wrap items-center justify-between gap-inline">
          <h2 className="mb-0">{t('navigation.departments')}</h2>
          <Button
            onClick={() => {
              setEditingDepartment(null)
              setCreatingDepartment((open) => !open)
            }}
          >
            {creatingDepartment ? t('common.cancel') : t('departments.newDepartment')}
          </Button>
        </div>
        {departmentsError && <p role="alert">{departmentsError}</p>}

        {creatingDepartment && (
          <Card className="mb-panel-gap">
            <CardContent>
              <DepartmentForm
                departments={departments}
                submitLabel={t('departments.createDepartment')}
                onSubmit={handleCreateDepartment}
              />
            </CardContent>
          </Card>
        )}

        {editingDepartment && (
          <Card className="mb-panel-gap">
            <CardContent>
              <DepartmentForm
                key={editingDepartment.id}
                departments={departments}
                excludeIdFromParentOptions={editingDepartment.id}
                submitLabel={t('departments.saveChanges')}
                initialValues={{
                  name: editingDepartment.name,
                  description: editingDepartment.description ?? '',
                  parentDepartmentId: editingDepartment.parentDepartmentId ?? '',
                  isActive: editingDepartment.isActive,
                }}
                onSubmit={handleUpdateDepartment}
              />
              <div className="mt-panel-gap">
                <Button variant="ghost" onClick={() => setEditingDepartment(null)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* The rule is applied only when there are rows: `DepartmentList` renders
            a bare paragraph when the company has no departments yet, and a box
            drawn around one sentence reads as an empty table rather than as a
            note. */}
        <div
          className={
            departments.length > 0
              ? 'overflow-hidden rounded-lg border border-line-light'
              : undefined
          }
        >
          <DepartmentList departments={departments} onEdit={setEditingDepartment} />
        </div>
      </section>
    </div>
  )
}

/**
 * One labelled reading in a settings tile.
 *
 * Not exported: `react(only-export-components)` counts every export in a file,
 * and this has one caller. `mono` is set for anything that is a *number or an
 * identifier* — a count, a retention period, a domain — and left off prose like
 * an industry or a company name, which is the typographic rule the whole redesign
 * turns on.
 *
 * ## The box grows; it is not a control
 *
 * `min-h-control-lg` and not `h-control-lg`. Every other reading in the product
 * that borrows the control height is a single-line control that cannot wrap —
 * a tab, a select, a date picker. These hold prose the company chose: `name` is
 * `HasMaxLength(200)`, `emailDomain` 255, `industry` 100. An ordinary
 * 36-character domain wraps to two lines at 390px, and against a hard 32px the
 * first line escapes above the border and the second below it, into the next
 * label. The minimum keeps the single-line case at exactly the control height,
 * so nothing that used to fit moves; `py-1` gives the wrapped case room.
 */
function SettingReadout({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null
  mono?: boolean
}): ReactNode {
  const { t } = useTranslation()

  return (
    <div className="grid gap-1">
      <span className="text-xs font-semibold text-fg-secondary">{label}</span>
      <div className="flex min-h-control-lg items-center rounded-md border border-line-default bg-surface-input px-3 py-1">
        {value ? (
          <span className={mono ? 'font-mono tabular-nums' : undefined}>{value}</span>
        ) : (
          // An empty box would read as a field this screen failed to fill in.
          //
          // `text-fg-secondary`, not `text-fg-light`. This is rendered content —
          // the answer the page gives to "what is the email domain?" — not an
          // input placeholder and not a disabled control, so none of AA 1.4.3's
          // exceptions apply to it. `--admin-font-light` is #999999 on white and
          // #555555 on #1e1e1e: 2.85:1 and 2.24:1, both under 4.5:1, and
          // styles/README.md reserves that token for "Disabled, section labels".
          // `--admin-font-secondary` reads 9.29:1 / 7.95:1 and still sits a step
          // below the set values, which inherit `--admin-font-primary`.
          <span className="text-fg-secondary">{t('companySettings.notSet')}</span>
        )}
      </div>
    </div>
  )
}
